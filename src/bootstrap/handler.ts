import {
  FeatureFlag,
  hasFlag,
  parseFeatureFlagsHeader,
} from "./feature_flags.ts";
import { FunctionChain } from "./function_chain.ts";
import { Logger } from "./log/instrumented_log.ts";
import { detachedLogger } from "./log/logger.ts";
import {
  EdgeRequest,
  getCacheMode,
  getFeatureFlags,
  getLogger,
  getPassthroughHeaders,
} from "./request.ts";
import { getEnvironment, populateEnvironment } from "./environment.ts";
import { Netlify } from "./globals/implementation.ts";
import {
  ensureNoTransform,
  InternalHeaders,
  mutateHeaders,
  StandardHeaders,
} from "./headers.ts";
import { parseRequestInvocationMetadata } from "./invocation_metadata.ts";
import { RequestMetrics } from "./metrics.ts";
import { Router } from "./router.ts";
import type { Functions } from "./stage_2.ts";
import { ErrorType, PassthroughError, UserError } from "./util/errors.ts";
import "./globals/types.ts";

interface HandleRequestOptions {
  fetchRewrites?: Map<string, string>;
  rawLogger?: Logger;
  requestTimeout?: number;
}

globalThis.Netlify = Netlify;

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

    let functionNames = functionNamesHeader.split(",");

    // We don't want to run the same function multiple times in the same chain,
    // so we deduplicate the function names while preserving their order.
    if (hasFlag(edgeReq, FeatureFlag.DedupeFunctions)) {
      functionNames = [...new Set(functionNames)];
    }

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

    if (hasFlag(edgeReq, FeatureFlag.PopulateEnvironment)) {
      populateEnvironment(edgeReq);
    }

    reqLogger
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
      // An issue with `Deno.serve` body compression is causing browsers to
      // buffer responses that should be streamed. As a temporary workaround,
      // we ensure that the response has `cache-control: no-transform`.
      // TODO: Remove once this issue has been fixed:
      // https://github.com/denoland/netlify-support/issues/10
      if (
        environment === "local" ||
        hasFlag(edgeReq, FeatureFlag.ForceNoTransform)
      ) {
        ensureNoTransform(headers);
      }

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
      let fields: Record<string, string | undefined> = {};

      if (error instanceof Error) {
        const errorType = error instanceof UserError
          ? ErrorType.User
          : ErrorType.Unknown;

        fields = {
          error_name: error.name,
          error_message: error.message,
          error_stack: error.stack,
          error_cause: String(error.cause),
          error_type: errorType,
        };
      } else {
        fields = {
          error_message: String(error),
        };
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
