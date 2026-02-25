import { setBlobsContext } from "./blobs.ts";
import {
  BypassResponse,
  supportsPassthroughBypass,
  supportsRewriteBypass,
} from "./bypass.ts";
import type { Context, NextOptions } from "./context.ts";
import { CookieStore } from "./cookie_store.ts";
import { instrumentedLog, Logger } from "./log/instrumented_log.ts";
import { instrumentedConsole } from "./log/logger.ts";
import {
  hasMutatedHeaders,
  mutateHeaders,
  StandardHeaders,
} from "./headers.ts";
import { RequestMetrics } from "./metrics.ts";
import { getPathParameters } from "./path_parameters.ts";
import {
  CacheMode,
  EdgeRequest,
  getAccount,
  getBlobs,
  getCacheMode,
  getDeploy,
  getGeoLocation,
  getIdentity,
  getIP,
  getLogger,
  getLogToken,
  getRegion,
  getRequestID,
  getSite,
  getSpanID,
  PassthroughRequest,
  setPassthroughHeaders,
} from "./request.ts";
import { backoffRetry } from "./retry.ts";
import { OriginResponse } from "./response.ts";
import { OnError, Router } from "./router.ts";
import {
  PassthroughError,
  UnretriableError,
  UserError,
} from "./util/errors.ts";
import { executionStore } from "./util/execution_context.ts";
import { isRedirect } from "./util/redirect.ts";
import { FeatureFlag, hasFlag } from "./feature_flags.ts";
import { env } from "../runtime/env.ts";
import { waitUntil } from "./wait_until.ts";

interface FunctionChainOptions {
  cookies?: CookieStore;
  executionController?: AbortController;
  functionNames: string[];
  initialMetrics?: RequestMetrics;
  initialRequestURL?: URL;
  loggedMessages?: Set<string>;
  rawLogger: Logger;
  request: EdgeRequest;
  router: Router;
  timeoutSignal?: AbortSignal;
}

interface RunOptions {
  previousRewrites?: Set<string>;
  requireFinalResponse?: boolean;
}

interface RunFunctionOptions {
  functionIndex: number;
  nextOptions?: NextOptions;
  requireFinalResponse?: boolean;
  previousRewrites?: Set<string>;
}

let denoRegion = "";
const DENO_RUNNER_IP = env.get("DENO_RUNNER_IP") ?? "";

class FunctionChain {
  cacheMode: CacheMode;
  cookies: CookieStore;
  contextNextCalls: NextOptions[];
  executionController: AbortController;
  functionNames: string[];
  initialHeaders: Headers;
  initialRequestURL: URL;
  loggedMessages: Set<string>;
  metrics: RequestMetrics;
  rawLogger: Logger;
  request: EdgeRequest;
  router: Router;
  timeoutSignal?: AbortSignal;

  constructor(
    {
      request,
      cookies = new CookieStore(request),
      executionController,
      functionNames,
      initialMetrics,
      initialRequestURL = new URL(request.url),
      loggedMessages,
      rawLogger,
      router,
      timeoutSignal,
    }: FunctionChainOptions,
    parentChain?: FunctionChain,
  ) {
    this.cacheMode = getCacheMode(request);
    this.cookies = cookies;
    this.contextNextCalls = [];
    this.executionController = executionController ?? new AbortController();
    this.functionNames = functionNames;
    this.initialHeaders = new Headers(request.headers);
    this.initialRequestURL = initialRequestURL;
    this.loggedMessages = loggedMessages ?? new Set();
    this.metrics = new RequestMetrics(initialMetrics ?? parentChain?.metrics);
    this.rawLogger = rawLogger;
    this.request = request;
    this.router = router;
    this.timeoutSignal = timeoutSignal ?? parentChain?.timeoutSignal;
    denoRegion = getRegion(this.request);
  }

  async fetchPassthrough(url?: URL) {
    try {
      return await this.fetchPassthroughWithRetries(url);
    } catch (error: any) {
      throw new PassthroughError(error);
    }
  }

  async fetchPassthroughWithRetries(url?: URL) {
    const startTime = performance.now();

    // We strip the conditional headers if `context.next()` was called and at
    // least one of the calls was missing the `sendConditionalRequest` option.
    const stripConditionalHeaders = this.contextNextCalls.length > 0 &&
      this.contextNextCalls.some((options) => !options.sendConditionalRequest);
    const originReq = new PassthroughRequest({
      req: this.request,
      stripConditionalHeaders,
      url,
    });

    const res = await backoffRetry(async (retryCount) => {
      const fetchLogger = this.logger
        .withFields({
          context_next_count: this.contextNextCalls.length,
          method: originReq.method,
          origin_url: originReq.url,
          retry_count: retryCount,
          strip_conditional_headers: stripConditionalHeaders,
          deno_runner_public_ip: DENO_RUNNER_IP,
        });

      fetchLogger.debug(
        retryCount === 0
          ? "Started edge function request to origin"
          : "Retrying edge function request to origin",
      );

      const signal = AbortSignal.any([
        originReq.signal,
        this.executionController.signal,
      ]);
      const call = this.metrics.startPassthrough();

      let result: Response | undefined;

      try {
        result = await fetch(originReq, {
          redirect: "manual",
          signal,
        });

        return result;
      } catch (error: any) {
        const isStreamError = error.name === "TypeError" &&
          (error.message === "Failed to fetch: request body stream errored" ||
            error.message.includes("http2 error: stream error sent by user"));

        // If the client went away, stop retrying and return a 499 immediately.
        if (isStreamError || originReq.signal.aborted) {
          return new Response(null, { status: 499 });
        }

        fetchLogger.withFields({
          body_used: originReq.bodyUsed,
          error: error.message,
        }).log(
          "Error in passthrough call",
        );

        // We can't retry requests whose body has already been consumed. If the
        // request failed because the associated signal has aborted, we don't
        // want to retry either.
        const canRetry = !originReq.bodyUsed && error.name !== "AbortError";

        throw canRetry ? error : new UnretriableError(error);
      } finally {
        call.end(result?.headers.get("cache-status"));
      }
    });

    const originRes = new OriginResponse(res);
    setPassthroughHeaders(this.request, originRes);

    this.logger
      .withFields({
        origin_duration: performance.now() - startTime,
        origin_status: res.status,
        origin_url: url,
      })
      .withRequestID(this.requestID)
      .withLogToken(this.logToken)
      .debug(
        "Finished edge function request to origin",
      );

    return originRes;
  }

  contextNext(
    functionIndex: number,
    newRequest?: Request,
    options: NextOptions = {},
  ) {
    if (
      newRequest &&
      new URL(newRequest.url).origin !== new URL(this.request.url).origin
    ) {
      throw new UserError(
        "Edge functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
      );
    }

    this.contextNextCalls.push(options);

    if (newRequest) {
      this.request = new EdgeRequest(newRequest, this.request);
    }

    return this.runFunction({
      functionIndex: functionIndex + 1,
      nextOptions: options,

      // `context.next()` calls always require a final response (i.e. no bypass
      // signals), as they may be used for transformation.
      requireFinalResponse: true,
    });
  }

  get identityContext() {
    return getIdentity(this.request);
  }

  getContext(functionIndex: number) {
    const route = this.router.getRequestRoute(functionIndex);
    const path = route?.path ?? "";
    const url = this.request.url;
    const context: Context = {
      cookies: this.cookies.getPublicInterface(),
      deploy: getDeploy(this.request),
      geo: getGeoLocation(this.request),
      ip: getIP(this.request),
      json: this.json.bind(this),
      log: this.getLogFunction(functionIndex),
      next: (
        reqOrOptions?: Request | NextOptions,
        options: NextOptions = {},
      ) => {
        this.logger.withFields({
          functionIndex,
          functionName: this.functionNames[functionIndex],
        }).debug(
          "Function called `context.next()`",
        );

        if (reqOrOptions instanceof Request) {
          return this.contextNext(functionIndex, reqOrOptions, options);
        }

        return this.contextNext(functionIndex, undefined, reqOrOptions);
      },
      get params() {
        return getPathParameters(route?.path, url);
      },
      path,
      requestId: this.requestID,
      spanID: this.spanID,
      rewrite: this.rewrite.bind(this),
      site: getSite(this.request),
      account: getAccount(this.request),
      server: {
        region: denoRegion,
      },
      url: new URL(url),
      waitUntil,
    };

    return context;
  }

  getFunction(functionIndex: number) {
    const name = this.functionNames[functionIndex];

    if (name === undefined) {
      return;
    }

    const func = this.router.getFunction(name);

    if (func === undefined) {
      throw new Error(`Could not find function '${name}'`);
    }

    const { config, source } = func;

    return {
      config,
      name,
      source,
    };
  }

  getLogFunction(functionIndex: number) {
    const functionName = this.functionNames[functionIndex];
    const logger = this.rawLogger ?? console.log;

    return (...data: unknown[]) => {
      return instrumentedLog(
        logger,
        data,
        {
          chain: this,
          functionName,
          requestID: this.requestID,
          spanID: this.spanID,
          logToken: this.logToken,
          logLevel: "info",
        },
      );
    };
  }

  // Returns a system logger associated with this request.
  get logger() {
    return getLogger(this.request);
  }

  // Returns a system logger associated with this request with a filter that
  // prevents the same message from being logged multiple times.
  get throttledLogger() {
    return getLogger(this.request).withFilter((message) => {
      if (this.loggedMessages.has(message)) {
        return false;
      }

      this.loggedMessages.add(message);

      return true;
    });
  }

  json(input: unknown, init?: ResponseInit) {
    const value = JSON.stringify(input);
    const response = new Response(value, init);

    response.headers.set("content-type", "application/json");

    return response;
  }

  makeURL(urlPath: string) {
    if (urlPath.startsWith("/")) {
      return new URL(urlPath, this.request.url);
    }

    return new URL(urlPath);
  }

  get requestID() {
    return getRequestID(this.request);
  }

  get spanID() {
    return getSpanID(this.request);
  }

  get logToken() {
    return getLogToken(this.request);
  }

  rewrite(url: string | URL) {
    const newUrl = url instanceof URL ? url : this.makeURL(url);

    if (newUrl.origin !== this.initialRequestURL.origin) {
      throw new UserError(
        "Edge functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
      );
    }

    this.logger.withFields({ url: newUrl.href }).debug(
      "Calling origin as part of a `context.rewrite()` call",
    );

    return this.fetchPassthrough(newUrl);
  }

  async run(
    { previousRewrites, requireFinalResponse }: RunOptions = {},
  ) {
    const blobsMetadata = getBlobs(this.request);
    const deploy = getDeploy(this.request);
    const site = getSite(this.request);

    setBlobsContext(blobsMetadata, deploy, site);

    let response = await this.runFunction({
      functionIndex: 0,
      previousRewrites,
      requireFinalResponse,
    });

    // Adding to the response any cookies that have been modified via the
    // `context.cookies` interface. If the response is a bypass, we don't
    // need to do it because the right headers have already been added to
    // the bypass body.
    if (!(response instanceof BypassResponse)) {
      // A response produced by `Response.redirect` has immutable headers, so
      // we detect that case and create a new response where we can apply the
      // cookies.
      if (isRedirect(response)) {
        response = new Response(null, response);
      }

      this.cookies.apply(response.headers);
    }

    return response;
  }

  runWithSignal(
    options?: RunOptions,
  ) {
    let chainHasFinished = false;

    const timeoutSignal = this.timeoutSignal;

    if (!timeoutSignal) {
      return this.run(options);
    }

    // When this signal aborts, the maximum time to return a response has been
    // exhausted. If we haven't already returned a response, we abort the main
    // execution controller. If not, we do nothing.
    timeoutSignal.addEventListener("abort", () => {
      if (!chainHasFinished) {
        this.executionController.abort();
      }
    });

    return new Promise<Response>((resolve, reject) => {
      // If the execution controller aborts, we want to stop the invocation in
      // its tracks, so we reject the Promise.
      this.executionController.signal.addEventListener("abort", () => {
        reject(this.executionController.signal.reason);
      });

      this.run(options).then(resolve).catch(reject).finally(() => {
        // The chain has finished. We no longer want the execution controller
        // to abort.
        chainHasFinished = true;
      });
    });
  }

  async runFunction({
    functionIndex,
    nextOptions,
    previousRewrites = new Set(),
    requireFinalResponse = false,
  }: RunFunctionOptions): Promise<Response> {
    const func = this.getFunction(functionIndex);
    const logger = this.logger.withFields({
      functionIndex,
      functionName: func?.name,
      url: this.request.url,
    });

    // We got to the end of the chain and the last function has early-returned.
    if (func === undefined) {
      // At this point, the edge functions have finished the invocation and the
      // request needs to follow its normal course in the request chain. To do
      // this, we can make a passthrough call to our edge nodes. Alternatively,
      // we can return a special response that instructs our edge node to do
      // that, which is an optimization that avoids a round-trip from Deno to us.
      // However, we can only do this when all of the conditions below are met:
      //
      // 1. The incoming request has a header that indicates that the edge node
      //    supports this optimization
      // 2. The caller hasn't specified that it needs the final response to be
      //    returned, which needs to happen for transformations
      // 3. The request doesn't have a body — if it does, it's already been
      //    consumed and our edge node won't be able to process it further
      // 4. The function is running before the cache — if we're running after
      //    the cache, it's too late for us to do a bypass
      // 5. The function hasn't mutated request headers without the edge node
      //    supporting the advanced bypass mechanism that lets it return the
      //    mutations in the response body
      if (
        supportsPassthroughBypass(this.request) && !requireFinalResponse &&
        this.request.body === null &&
        getCacheMode(this.request) === CacheMode.Off &&
        (!hasMutatedHeaders(this.initialHeaders, this.request.headers) ||
          supportsRewriteBypass(this.request))
      ) {
        logger.debug("Returning bypass response");

        return new BypassResponse({
          cookies: this.cookies,
          currentRequest: this.request,
          initialRequestHeaders: this.initialHeaders,
          initialRequestURL: this.initialRequestURL,
        });
      }

      logger.withFields({
        supportsPassthroughBypass: supportsPassthroughBypass(this.request),
        requireFinalResponse,
        hasBody: this.request.body !== null,
        mutatedHeaders: hasMutatedHeaders(
          this.initialHeaders,
          this.request.headers,
        ),
        supportsRewriteBypass: supportsRewriteBypass(this.request),
      }).debug("Calling origin at the end of function chain");

      return this.fetchPassthrough();
    }

    const { config, name, source } = func;
    const context = this.getContext(functionIndex);

    this.metrics.registerInvokedFunction(name);

    try {
      // Wrap the function call with the execution context, so that we can find
      // the request context from any scope. Uses Node's `AsyncLocalStorage`.
      const result = await executionStore.run(
        {
          chain: this,
          functionIndex,
        },
        () => source(this.request, context) as unknown,
      );

      // If the function returned a URL object, it means a rewrite.
      if (result instanceof URL) {
        logger.debug("Function returned a URL object");

        if (result.origin !== this.initialRequestURL.origin) {
          throw new UserError(
            `Rewrite to '${result.toString()}' is not allowed: edge functions can only rewrite requests to the same base URL`,
          );
        }

        // Rather than rewriting inside the isolate by making a passthrough
        // request and returning the response, we can run the rewrite in our
        // edge nodes by returning a special bypass response. We can do this
        // when the following conditions are met:
        //
        // 1. The incoming request has a header that indicates that the edge
        //    node supports this optimization
        // 2. The request doesn't have a body — if it does, it's already been
        //    consumed and our edge node won't be able to process it further
        const canBypass = supportsRewriteBypass(this.request) &&
          this.request.body === null;
        const isLoop = previousRewrites.has(result.pathname);

        if (isLoop) {
          throw new UserError(
            `Loop detected: the path '${result.pathname}' has been both the source and the target of a rewrite in the same request`,
          );
        }

        const newRequest = new EdgeRequest(result, this.request);

        // Run any functions configured for the new path.
        const functions = this.router.match(result, newRequest);

        // If there are no functions configured for the new path, we can run
        // the rewrite. This means making a passthrough call if the caller
        // has requested a final response, or returning a bypass response
        // otherwise.
        if (functions.length === 0) {
          if (canBypass && !requireFinalResponse) {
            return new BypassResponse({
              cookies: this.cookies,
              currentRequest: newRequest,
              initialRequestHeaders: this.initialHeaders,
              initialRequestURL: this.initialRequestURL,
            });
          }

          logger.withFields({ canBypass, requireFinalResponse }).debug(
            "Calling origin as a result of a rewrite with a URL object",
          );

          return this.fetchPassthrough(result);
        }

        const newChain = new FunctionChain({
          cookies: this.cookies,
          executionController: this.executionController,
          functionNames: functions.map((route) => route.name),
          initialRequestURL: this.initialRequestURL,
          rawLogger: this.rawLogger,
          request: newRequest,
          router: this.router,
          timeoutSignal: this.timeoutSignal,
        }, this);
        const runOptions: RunOptions = {
          previousRewrites: new Set([
            ...previousRewrites,
            result.pathname,
          ]),
          requireFinalResponse: requireFinalResponse || !canBypass,
        };

        if (this.timeoutSignal) {
          return newChain.runWithSignal(runOptions);
        }

        return newChain.run(runOptions);
      }

      // If the function returned undefined, it means a bypass. Call the next
      // function in the chain.
      if (result === undefined) {
        logger.debug("Function returned undefined");

        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions,
          requireFinalResponse,
        });
      }

      // If the function returned a response, return that.
      if (result instanceof Response) {
        logger.debug("Function returned a response");

        // It's possible that user code may have set a `content-length` value
        // that doesn't match what we're actually sending in the body, so we
        // just strip out the header entirely since it's not required in an
        // HTTP/2 connection.
        return mutateHeaders(result, (headers) => {
          headers.delete(StandardHeaders.ContentLength);

          // For HTTP/1.1, use chunked encoding to avoid content-length issues
          if (hasFlag(this.request, FeatureFlag.ForceHTTP11)) {
            headers.set("transfer-encoding", "chunked");
          }
        });
      }

      throw new UserError(
        `Function '${name}' returned an unsupported value. Accepted types are 'Response', 'URL' or 'undefined'`,
      );
    } catch (error) {
      const errorMetadata = {
        chain: this,
        functionName: name,
        requestID: this.requestID,
        spanID: this.spanID,
        logToken: this.logToken,
      };

      const logUncaughtError = () =>
        executionStore.run(
          { chain: this, functionIndex },
          () => instrumentedConsole.error(errorMetadata, error),
        );

      logger.withFields({ onError: config.onError })
        .debug("Function has thrown an error");

      // In the default failure mode, we just re-throw the error. It will be
      // handled upstream.
      if (config.onError === OnError.Fail) {
        logUncaughtError();

        throw error;
      }

      // In the "bypass" failure mode, we run the next function in the chain.
      if (config.onError === OnError.Bypass) {
        logUncaughtError();

        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions,
          requireFinalResponse,
        });
      }

      // At this point, we know that the failure mode is a rewrite. If the
      // caller requires a final response (e.g. they call `context.next()`),
      // we re-throw the error and let the caller handle it (either using a
      // `try/catch` or its own failure mode).
      if (requireFinalResponse) {
        throw error;
      }

      logUncaughtError();

      // Otherwise, return a bypass response with the new URL.
      const url = new URL(config.onError, this.request.url);

      if (supportsRewriteBypass(this.request)) {
        return new BypassResponse({
          cookies: this.cookies,
          currentRequest: new EdgeRequest(url, this.request),
          initialRequestHeaders: this.initialHeaders,
          initialRequestURL: this.initialRequestURL,
        });
      }

      this.logger.debug("Calling origin as part of a rewrite failure mode");

      return this.fetchPassthrough(url);
    }
  }
}

export { FunctionChain };
export type { Context };
