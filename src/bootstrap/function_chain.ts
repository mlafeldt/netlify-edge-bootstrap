import {
  BypassResponse,
  supportsPassthroughBypass,
  supportsRewriteBypass,
} from "./bypass.ts";
import type { Context, NextOptions } from "./context.ts";
import { CookieStore } from "./cookie_store.ts";
import { instrumentedLog, Logger } from "./log/instrumented_log.ts";
import { FeatureFlag, hasFlag } from "./feature_flags.ts";
import { logger } from "./log/logger.ts";
import {
  hasMutatedHeaders,
  InternalHeaders,
  mutateHeaders,
  StandardHeaders,
} from "./headers.ts";
import {
  CacheMode,
  EdgeRequest,
  getAccount,
  getBlobs,
  getCacheMode,
  getGeoLocation,
  getIP,
  getRequestID,
  getSite,
  PassthroughRequest,
  setPassthroughHeaders,
} from "./request.ts";
import { backoffRetry } from "./retry.ts";
import { OriginResponse } from "./response.ts";
import { OnError, Router } from "./router.ts";
import { UnretriableError, UserError } from "./util/errors.ts";
import { callWithNamedWrapper } from "./util/named_wrapper.ts";
import { isRedirect } from "./util/redirect.ts";
import { StackTracer } from "./util/stack_tracer.ts";

interface FunctionChainOptions {
  cookies?: CookieStore;
  functionNames: string[];
  initialRequestURL?: URL;
  invokedFunctions?: string[];
  rawLogger: Logger;
  request: EdgeRequest;
  router: Router;
}

interface RunFunctionOptions {
  functionIndex: number;
  nextOptions?: NextOptions;
  requireFinalResponse?: boolean;
  previousRewrites?: Set<string>;
}

class FunctionChain {
  cacheMode: CacheMode;
  cookies: CookieStore;
  contextNextCalls: NextOptions[];
  debug: boolean;
  functionNames: string[];
  initialHeaders: Headers;
  initialRequestURL: URL;
  invokedFunctions: string[];
  rawLogger: Logger;
  request: EdgeRequest;
  router: Router;

  constructor(
    {
      request,
      cookies = new CookieStore(request),
      functionNames,
      initialRequestURL = new URL(request.url),
      invokedFunctions = [],
      rawLogger,
      router,
    }: FunctionChainOptions,
  ) {
    this.cacheMode = getCacheMode(request);
    this.cookies = cookies;
    this.contextNextCalls = [];
    this.debug = Boolean(request.headers.get(InternalHeaders.DebugLogging));
    this.functionNames = functionNames;
    this.initialHeaders = new Headers(request.headers);
    this.initialRequestURL = initialRequestURL;
    this.invokedFunctions = invokedFunctions;
    this.rawLogger = rawLogger;
    this.request = request;
    this.router = router;
  }

  async fetchPassthrough(url?: URL) {
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
      const fetchLogger = logger
        .withFields({
          context_next_count: this.contextNextCalls.length,
          origin_url: url,
          retry_count: retryCount,
          strip_conditional_headers: stripConditionalHeaders,
        })
        .withRequestID(getRequestID(this.request));

      if (this.debug) {
        const message = retryCount === 0
          ? "Started edge function request to origin"
          : "Retrying edge function request to origin";

        fetchLogger.log(message);
      }

      try {
        return await fetch(originReq, { redirect: "manual" });
      } catch (error) {
        // If the client went away, stop retrying and return a 499 immediately.
        if (
          error.name === "TypeError" &&
          error.message === "Failed to fetch: request body stream errored"
        ) {
          return new Response(null, { status: 499 });
        }

        if (hasFlag(this.request, FeatureFlag.StripContentLength)) {
          fetchLogger.withFields({ error: error.message }).log(
            "Error in passthrough call",
          );
        }

        // We can't retry requests whose body has already been consumed.
        const FetchError = originReq.bodyUsed ? UnretriableError : Error;

        throw new FetchError(
          "There was an internal error while processing your request",
          {
            cause: error,
          },
        );
      }
    });
    const originRes = new OriginResponse(res);
    setPassthroughHeaders(this.request, originRes);

    const endTime = performance.now();

    if (this.debug) {
      logger
        .withFields({
          origin_duration: endTime - startTime,
          origin_status: res.status,
          origin_url: url,
        })
        .withRequestID(getRequestID(this.request))
        .log(
          "Finished edge function request to origin",
        );
    }

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

  getContext(functionIndex: number) {
    const context: Context = {
      cookies: this.cookies.getPublicInterface(),
      geo: getGeoLocation(this.request),
      ip: getIP(this.request),
      json: this.json.bind(this),
      log: this.getLogFunction(functionIndex),
      next: (
        reqOrOptions?: Request | NextOptions,
        options: NextOptions = {},
      ) => {
        if (reqOrOptions instanceof Request) {
          return this.contextNext(functionIndex, reqOrOptions, options);
        }

        return this.contextNext(functionIndex, undefined, reqOrOptions);
      },
      requestId: getRequestID(this.request),
      rewrite: this.rewrite.bind(this),
      site: getSite(this.request),
      account: getAccount(this.request),
      server: {
        region: Deno.env.get("DENO_REGION") ?? "",
      },
    };

    if (hasFlag(this.request, FeatureFlag.Netliblob)) {
      // @ts-expect-error We're not adding this to the public types until we're
      // ready to commit to launching this feature.
      context.blobs = getBlobs(this.request);
    }

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
        functionName,
        getRequestID(this.request),
      );
    };
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

  rewrite(url: string | URL) {
    const newUrl = url instanceof URL ? url : this.makeURL(url);

    if (newUrl.origin !== this.initialRequestURL.origin) {
      throw new UserError(
        "Edge functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
      );
    }

    return this.fetchPassthrough(newUrl);
  }

  async run(
    { previousRewrites, requireFinalResponse }: {
      previousRewrites?: Set<string>;
      requireFinalResponse?: boolean;
    } = {},
  ) {
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

  async runFunction({
    functionIndex,
    nextOptions,
    previousRewrites = new Set(),
    requireFinalResponse = false,
  }: RunFunctionOptions): Promise<Response> {
    const func = this.getFunction(functionIndex);

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
        return new BypassResponse({
          cookies: this.cookies,
          currentRequest: this.request,
          initialRequestHeaders: this.initialHeaders,
          initialRequestURL: this.initialRequestURL,
        });
      }

      return this.fetchPassthrough();
    }

    const { config, name, source } = func;
    const context = this.getContext(functionIndex);

    this.invokedFunctions.push(name);

    try {
      // Rather than calling the function directly, we call it through a special
      // identity function. The name of this function has a marker that allows us
      // to decode the request ID from any `console.log` calls by inspecting the
      // stack trace.
      const result = await callWithNamedWrapper(
        // Type-asserting to `unknown` because user code can return anything.
        () => source(this.request, context) as unknown,
        StackTracer.serializeRequestID(getRequestID(this.request)),
      );

      // If the function returned a URL object, it means a rewrite.
      if (result instanceof URL) {
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
        const functions = this.router.match(result);

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

          return this.fetchPassthrough(result);
        }

        const newChain = new FunctionChain({
          cookies: this.cookies,
          functionNames: functions.map((route) => route.name),
          initialRequestURL: this.initialRequestURL,
          invokedFunctions: this.invokedFunctions,
          rawLogger: this.rawLogger,
          request: newRequest,
          router: this.router,
        });

        return newChain.run({
          previousRewrites: new Set([
            ...previousRewrites,
            result.pathname,
          ]),
          requireFinalResponse: requireFinalResponse || !canBypass,
        });
      }

      // If the function returned undefined, it means a bypass. Call the next
      // function in the chain.
      if (result === undefined) {
        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions,
          requireFinalResponse,
        });
      }

      // If the function returned a response, return that.
      if (result instanceof Response) {
        // It's possible that user code may have set a `content-length` value
        // that doesn't match what we're actually sending in the body, so we
        // just strip out the header entirely since it's not required in an
        // HTTP/2 connection.
        if (hasFlag(this.request, FeatureFlag.StripContentLength)) {
          return mutateHeaders(result, (headers) => {
            headers.delete(StandardHeaders.ContentLength);
          });
        }

        return result;
      }

      throw new UserError(
        `Function '${name}' returned an unsupported value. Accepted types are 'Response', 'URL' or 'undefined'`,
      );
    } catch (error) {
      const supportsFailureModes = hasFlag(
        this.request,
        FeatureFlag.FailureModes,
      );

      // In the default failure mode, we just re-throw the error. It will be
      // handled upstream.
      if (!supportsFailureModes || config.onError === OnError.Fail) {
        context.log(error);

        throw error;
      }

      // In the "bypass" failure mode, we run the next function in the chain.
      if (config.onError === OnError.Bypass) {
        context.log(error);

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

      context.log(error);

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

      return this.fetchPassthrough(url);
    }
  }
}

export { FunctionChain };
export type { Context };
