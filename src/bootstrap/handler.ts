import { FeatureFlag, parseFeatureFlagsHeader } from "./feature_flags.ts";
import { FunctionChain } from "./function_chain.ts";
import { Logger } from "./log/instrumented_log.ts";
import { detachedLogger } from "./log/logger.ts";
import {
  EdgeRequest,
  getCacheAPIToken,
  getCacheAPIURL,
  getCacheMode,
  getFeatureFlags,
  getLogger,
  getPassthroughHeaders,
} from "./request.ts";
import { getEnvironment, populateEnvironment } from "./environment.ts";
import { Netlify } from "./globals/implementation.ts";
import { InternalHeaders, mutateHeaders, StandardHeaders } from "./headers.ts";
import { parseRequestInvocationMetadata } from "./invocation_metadata.ts";
import { RequestMetrics } from "./metrics.ts";
import { Router } from "./router.ts";
import type { Functions } from "./stage_2.ts";
import { ErrorType, PassthroughError, UserError } from "./util/errors.ts";
import "./globals/types.ts";
import {
  patchFetchToForceHTTP11,
  patchFetchToHaveItsOwnConnectionPoolPerIsolate,
} from "./util/fetch.ts";

interface HandleRequestOptions {
  fetchRewrites?: Map<string, string>;
  rawLogger?: Logger;
  requestTimeout?: number;
}

globalThis.Netlify = Netlify;

// There is an issue in Deno where a cancellation of a client request leads to
// an exception that cannot be caught. This is a problem because the isolate
// will crash and will fail to serve normal requests. This handler checks for
// that case and stops the crash.
// https://github.com/denoland/deno/issues/27715
globalThis.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason instanceof DOMException && event.reason.name === "AbortError"
  ) {
    detachedLogger.withError(event.reason).debug(
      "found unhandled AbortError exception",
    );

    event.preventDefault();

    return;
  }
});

export const handleRequest = async (
  req: Request,
  functions: Functions,
  {
    fetchRewrites,
    rawLogger = console.log,
    requestTimeout = 0,
  }: HandleRequestOptions = {},
) => {
  const id = req.headers.get(InternalHeaders.RequestID);
  const environment = getEnvironment();
  const logger = detachedLogger.withRequestID(id);

  // We already parse this a bit later. Doing it here is a tiny bit expensive,
  // please remove this once you don't need it anymore.
  const featureFlags = parseFeatureFlagsHeader(
    req.headers.get(InternalHeaders.FeatureFlags),
  );

  // If the `UseOneClientPoolPerIsolate` feature flag is enabled, we patch the
  // fetch to use its own connection pool.
  if (featureFlags[FeatureFlag.UseOneClientPoolPerIsolate]) {
    // this is not incuded in the `patchGlobals` function because that function
    // is invoked before we have access to the feature flags. once this is fully
    // rolled out, we will want to move this into `patchGlobals`
    globalThis.fetch = patchFetchToHaveItsOwnConnectionPoolPerIsolate(
      globalThis.fetch,
    );
  }

  // if ForceHTTP11 is enabled, we patch the fetch to enforce HTTP/1.1
  if (featureFlags[FeatureFlag.ForceHTTP11]) {
    // this is not incuded in the `patchGlobals` function because that function
    // is invoked before we have access to the feature flags. once this is fully
    // rolled out, we will want to move this into `patchGlobals`
    globalThis.fetch = patchFetchToForceHTTP11(globalThis.fetch);
  }

  // A collector of all the functions invoked by this chain or any sub-chains
  // that it triggers.
  const metrics = new RequestMetrics();

  // An `AbortSignal` that will abort when the configured timeout is hit.
  const timeoutSignal =
    featureFlags[FeatureFlag.InvocationTimeout] && requestTimeout
      ? AbortSignal.timeout(requestTimeout)
      : undefined;

  try {
    const functionNamesHeader = req.headers.get(InternalHeaders.EdgeFunctions);
    const metadata = parseRequestInvocationMetadata(
      req.headers.get(InternalHeaders.InvocationMetadata),
    );
    const router = new Router(functions, metadata);

    if (id == null || functionNamesHeader == null) {
      return new Response(
        "Request must have headers for request ID and functions names",
        {
          status: 400,
          headers: { [StandardHeaders.ContentType]: "text/plain" },
        },
      );
    }

    const url = new URL(req.url);

    // The Golang and Node/Deno URL implementations disagree about the encoding of comma characters.
    // Stargate percent-encodes them before invoking the Edge Function
    // (see https://github.com/netlify/stargate/blob/5a0e0cdadf753223aba09b3e1cbadd702ed58364/proxy/deno/edge.go#L1202-L1206)
    // but Deno doesn't decode them by default.
    // We want this to work the same across Functions an Edge Functions, so we're doing it manually:
    if (featureFlags[FeatureFlag.DecodeQuery]) {
      try {
        url.search = decodeURIComponent(url.search);
      } catch {
        logger.withFields({ query: url.search }).log("Failed to decode query");
      }
    }

    if (getEnvironment() === "local") {
      // We need to change the URL we expose to user code to ensure it reflects
      // the URL of the main CLI server and not the one from the internal Deno
      // server.
      url.protocol = req.headers.get(InternalHeaders.ForwardedProtocol) ??
        url.protocol;
      url.host = req.headers.get(InternalHeaders.ForwardedHost) ?? url.host;

      // We also need to intercept any requests made to the same URL as the
      // incoming request, because we can only communicate with our "origin"
      // over HTTP (not HTTPS). If this applies, we've already patched the
      // global `fetch` upstream so that it looks at the `fetchRewrites` map
      // to determine whether it should rewrite the origin, so all we need to
      // do at this point is write to it.
      if (
        req.headers.has(InternalHeaders.PassthroughHost) &&
        req.headers.has(InternalHeaders.PassthroughProtocol)
      ) {
        const passthroughOrigin = `${
          req.headers.get(
            InternalHeaders.PassthroughProtocol,
          )
        }//${req.headers.get(InternalHeaders.PassthroughHost)}`;

        // No need to add a rewrite if the request origin is already the same
        // as the passthrough origin.
        if (passthroughOrigin !== url.origin) {
          fetchRewrites?.set(url.origin, passthroughOrigin);
        }
      }
    }

    const edgeReq = new EdgeRequest(new Request(url, req));
    const cacheAPIToken = getCacheAPIToken(edgeReq);
    const cacheAPIURL = getCacheAPIURL(edgeReq);

    // We don't want to run the same function multiple times in the same chain,
    // so we deduplicate the function names while preserving their order.
    const functionNames = [...new Set(functionNamesHeader.split(","))];

    const chain = new FunctionChain({
      functionNames,
      initialMetrics: metrics,
      rawLogger,
      request: edgeReq,
      router,
      timeoutSignal,
    });
    const reqLogger = getLogger(edgeReq).withFields({
      cache_mode: getCacheMode(edgeReq),
      feature_flags: Object.keys(getFeatureFlags(edgeReq)),
      function_names: functionNames,
      url: req.url,
    });

    populateEnvironment(edgeReq);

    reqLogger
      .withFields({
        cache_api_token: Boolean(cacheAPIToken),
        cache_api_url: Boolean(cacheAPIURL),
      })
      .debug("Started processing edge function request");

    const startTime = performance.now();
    const response =
      await (timeoutSignal ? chain.runWithSignal() : chain.run());

    // Propagate headers received from passthrough calls to the final response.
    getPassthroughHeaders(edgeReq).forEach((value, key) => {
      if (response.headers.has(key)) {
        reqLogger
          .withFields({ header: key })
          .log("user-defined header overwritten by passthrough header");
      }

      response.headers.set(key, value);
    });

    const endTime = performance.now();

    reqLogger
      .withFields({ ef_duration: endTime - startTime })
      .debug("Finished processing edge function request");

    return mutateHeaders(response, (headers) => {
      metrics.writeHeaders(headers);
    });
  } catch (error) {
    let errorString = String(error);

    if (environment === "local") {
      if (error instanceof Error) {
        errorString = JSON.stringify({
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: String(error.cause),
          },
        });
      } else {
        errorString = JSON.stringify({ error: String(error) });
      }
    } else if (environment === "production") {
      const fields: Record<string, string | undefined> = {
        fetch_timing: metrics.getFetchTiming().join(","),
        req_aborted: req.signal.aborted.toString(),
      };

      if (error instanceof Error) {
        const errorType = error instanceof UserError
          ? ErrorType.User
          : ErrorType.Unknown;

        fields.error_name = error.name;
        fields.error_message = error.message;
        fields.error_stack = error.stack;
        fields.error_cause = String(error.cause);
        fields.error_type = errorType;
      } else {
        fields.error_message = String(error);
      }

      logger
        .withFields(fields)
        .log("uncaught exception while handling request");
    }

    const response = new Response(errorString, {
      status: 500,
      headers: {
        [InternalHeaders.UncaughtError]: getInvocationErrorHeader(error),
      },
    });

    metrics.writeHeaders(response.headers);

    return response;
  }
};

const getInvocationErrorHeader = (error: unknown) => {
  if (error instanceof PassthroughError) {
    return "passthrough";
  }

  if (
    (error instanceof Error) &&
    (error?.name === "AbortError" || error?.name === "TimeoutError")
  ) {
    return "timeout";
  }

  return "1";
};
