import {
  BypassResponse,
  supportsPassthroughBypass,
  supportsRewriteBypass,
} from "./bypass.ts";
import type { Context, NextOptions } from "./context.ts";
import type { EdgeFunction } from "./edge_function.ts";
import { CookieStore } from "./cookie_store.ts";
import { instrumentedLog, Logger } from "./log/instrumented_log.ts";
import { logger } from "./log/logger.ts";
import { InternalHeaders } from "./headers.ts";
import {
  CacheMode,
  EdgeRequest,
  getAccount,
  getCacheMode,
  getGeoLocation,
  getIP,
  getRequestID,
  getSite,
  hasFeatureFlag,
  PassthroughRequest,
  setPassthroughTiming,
} from "./request.ts";
import { backoffRetry } from "./retry.ts";
import { OriginResponse } from "./response.ts";
import { Router } from "./router.ts";
import { UnhandledFunctionError, UnretriableError } from "./util/errors.ts";
import { callWithNamedWrapper } from "./util/named_wrapper.ts";
import { StackTracer } from "./util/stack_tracer.ts";

interface FunctionChainOptions {
  cookies?: CookieStore;
  functions: RequestFunction[];
  initialRequestURL?: URL;
  rawLogger: Logger;
  request: EdgeRequest;
  router: Router;
}

interface RequestFunction {
  name: string;
  function: EdgeFunction;
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
  functions: RequestFunction[];
  initialHeaders: Headers;
  initialRequestURL: URL;
  rawLogger: Logger;
  request: EdgeRequest;
  response: Response;
  router: Router;

  constructor(
    {
      request,
      cookies = new CookieStore(request),
      functions,
      initialRequestURL = new URL(request.url),
      rawLogger,
      router,
    }: FunctionChainOptions,
  ) {
    this.cacheMode = getCacheMode(request);
    this.cookies = cookies;
    this.contextNextCalls = [];
    this.debug = Boolean(request.headers.get(InternalHeaders.DebugLogging));
    this.functions = functions;
    this.initialHeaders = new Headers(request.headers);
    this.initialRequestURL = initialRequestURL;
    this.rawLogger = rawLogger;
    this.request = request;
    this.response = new Response();
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
        if (
          hasFeatureFlag(
            this.request,
            "edge_functions_bootstrap_log_passthrough_errors",
          )
        ) {
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
    const originRes = new OriginResponse(res, this.response);

    // The edge node will send a header with how much time was spent in going to
    // origin. We attach it to the request so that we can attach it to the final response
    // later.
    const passthroughTiming = originRes.headers.get(
      InternalHeaders.PassthroughTiming,
    );
    if (passthroughTiming) {
      setPassthroughTiming(this.request, passthroughTiming);
    }

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
      throw new Error(
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

    return context;
  }

  getLogFunction(functionIndex: number) {
    const { name } = this.functions[functionIndex];
    const logger = this.rawLogger ?? console.log;

    return (...data: unknown[]) => {
      return instrumentedLog(
        logger,
        data,
        name,
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

  async rewrite(url: string | URL) {
    const newUrl = url instanceof URL ? url : this.makeURL(url);
    const requestUrl = new URL(this.request.url);

    if (newUrl.origin !== requestUrl.origin) {
      throw new Error(
        "Edge functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
      );
    }

    const start = performance.now();
    const response = await this.fetchPassthrough(newUrl);
    const end = performance.now();
    const duration = end - start;

    logger
      .withFields({ duration: duration.toFixed(2) })
      .log("context.rewrite measured");

    return response;
  }

  async run(
    { previousRewrites, requireFinalResponse }: {
      previousRewrites?: Set<string>;
      requireFinalResponse?: boolean;
    } = {},
  ) {
    const response = await this.runFunction({
      functionIndex: 0,
      previousRewrites,
      requireFinalResponse,
    });

    // Adding to the response any cookies that have been modified via the
    // `context.cookies` interface. If the response is a bypass, we don't
    // need to do it because the right headers have already been added to
    // the bypass body.
    if (
      !(response instanceof BypassResponse && hasFeatureFlag(
        this.request,
        "edge_functions_bootstrap_bypass_response_headers",
      ))
    ) {
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
    const func = this.functions[functionIndex];

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
      if (
        supportsPassthroughBypass(this.request) && !requireFinalResponse &&
        this.request.body === null &&
        getCacheMode(this.request) === CacheMode.Off
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

    const context = this.getContext(functionIndex);

    try {
      // Rather than calling the function directly, we call it through a special
      // identity function. The name of this function has a marker that allows us
      // to decode the request ID from any `console.log` calls by inspecting the
      // stack trace.
      const result = await callWithNamedWrapper(
        // Type-asserting to `unknown` because user code can return anything.
        () => func.function(this.request, context) as unknown,
        StackTracer.serializeRequestID(getRequestID(this.request)),
      );

      // If the function returned a URL object, it means a rewrite.
      if (result instanceof URL) {
        if (result.origin !== new URL(this.request.url).origin) {
          throw new Error(
            `Rewrite to '${result.toString()}' is not allowed: edge functions can only rewrite requests to the same base URL`,
          );
        }

        // Rather than rewriting inside the isolate by making a passthrough
        // request and returning the response, we can run the rewrite in our
        // edge nodes by returning a special bypass response. We can do this
        // when all the following conditions are met:
        //
        // 1. The incoming request has a header that indicates that the edge
        //    node supports this optimization
        // 2. The request doesn't have a body — if it does, it's already been
        //    consumed and our edge node won't be able to process it further
        if (
          supportsRewriteBypass(this.request) &&
          this.request.body === null
        ) {
          const isLoop = previousRewrites.has(result.pathname);

          if (isLoop) {
            throw new Error(
              `Loop detected: the path '${result.pathname}' has been both the source and the target of a rewrite in the same request`,
            );
          }

          const newRequest = new EdgeRequest(result, this.request);

          // Before returning the bypass response, we need to run any functions
          // configured for the new path.
          const functions = this.router.match(result);

          // If there are no functions configured for the new path, we can run
          // the rewrite. This means making a passthrough call if the caller
          // has requested a final response, or returning a bypass response
          // otherwise.
          if (functions.length === 0) {
            if (requireFinalResponse) {
              return this.fetchPassthrough(result);
            }

            return new BypassResponse({
              cookies: this.cookies,
              currentRequest: newRequest,
              initialRequestHeaders: this.initialHeaders,
              initialRequestURL: this.initialRequestURL,
            });
          }

          const newChain = new FunctionChain({
            cookies: this.cookies,
            functions,
            initialRequestURL: this.initialRequestURL,
            rawLogger: this.rawLogger,
            request: newRequest,
            router: this.router,
          });

          return newChain.run({
            previousRewrites: new Set([...previousRewrites, result.pathname]),
            requireFinalResponse,
          });
        }

        return this.fetchPassthrough(result);
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
        return result;
      }

      throw new UnhandledFunctionError(
        `Function '${func.name}' returned an unsupported value. Accepted types are 'Response' or 'undefined'`,
      );
    } catch (error) {
      context.log(error);

      throw error;
    }
  }
}

export { FunctionChain };
export type { Context };
