import { FeatureFlag, parseFeatureFlagsHeader } from "./feature_flags.ts";
import { FunctionChain } from "./function_chain.ts";
import { NimbleConsole } from "./log/console.ts";
import { Logger } from "./log/instrumented_log.ts";
import { detachedLogger } from "./log/logger.ts";
import {
  EdgeRequest,
  getAccount,
  getCacheAPIToken,
  getCacheAPIURL,
  getCacheMode,
  getFeatureFlags,
  getLogger,
  getPassthroughHeaders,
  getSite,
  setFeatureFlags,
} from "./request.ts";
import {
  getEnvironment,
  injectEnvironmentVariablesFromHeader,
  populateEarlyAIEnvironment,
  populateEnvironment,
  resetInitialEnv,
  setHasPopulatedEnvironment,
} from "./environment.ts";
import { Netlify } from "./globals/implementation.ts";
import { setupIdentityGlobal } from "./identity.ts";
import { InternalHeaders, mutateHeaders, StandardHeaders } from "./headers.ts";
import { parseRequestInvocationMetadata } from "./invocation_metadata.ts";
import { RequestMetrics } from "./metrics.ts";
import { Router } from "./router.ts";
import type { Functions } from "./stage_2.ts";
import {
  ErrorType,
  PassthroughError,
  UnhandledRejectionError,
  UserError,
} from "./util/errors.ts";
import "./globals/types.ts";
import {
  patchFetchToForceHTTP11,
  patchFetchToHaveItsOwnConnectionPoolPerIsolate,
} from "./util/fetch.ts";
import { RequestContext, requestStore } from "./util/execution_context.ts";
import type { BundleManifest } from "./bundle_manifest.ts";

export type Annotations = {
  site_id?: string;
  deploy_id?: string;
  account_id?: string;
  account_tier?: string;
  branch?: string;
};

interface HandleRequestOptions {
  bundleManifest?: BundleManifest;
  fetchRewrites?: Map<string, string>;
  rawLogger?: Logger;
  requestTimeout?: number;
  executionController?: AbortController;
  requestContext?: RequestContext;
  annotations?: Annotations;
}

globalThis.Netlify = Netlify;
setupIdentityGlobal();

const isNimble = globalThis.console instanceof NimbleConsole;
const MB = 1024 * 1024;

// There is an issue in Deno where a cancellation of a client request leads to
// an exception that cannot be caught. This is a problem because the isolate
// will crash and will fail to serve normal requests. This handler checks for
// that case and stops the crash.
// https://github.com/denoland/deno/issues/27715
globalThis.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason instanceof DOMException &&
    event.reason.name === "AbortError"
  ) {
    detachedLogger
      .withError(event.reason)
      .debug("found unhandled AbortError exception");

    event.preventDefault();

    return;
  }

  if (isNimble) {
    // Default deno behavior would to write out unstructured log line, which breaks the log parsing,
    // so instead we log the error ourselves in a structured way using NimbleConsole,
    // prevent the default unstructured log.
    console.error(event.reason);
    // prevent crashing the process completely
    event.preventDefault();
    // fail current request if it didn't respond already
    requestStore
      .getStore()
      ?.abortExecution?.(new UnhandledRejectionError(event.reason));
    return;
  }
});

let functions: Functions | null = null;
let getFunctionsDuration: number | null = null;

export const handleRequest = (
  req: Request,
  getFunctions: () => Promise<Functions>,
  {
    bundleManifest,
    fetchRewrites,
    rawLogger = console.log,
    requestTimeout = 0,
    annotations,
  }: HandleRequestOptions = {},
): Promise<Response> => {
  const id = req.headers.get(InternalHeaders.RequestID);
  const logToken = req.headers.get(InternalHeaders.LogToken);
  const spanID = req.headers.get(InternalHeaders.NFTraceSpanID);

  const executionController = new AbortController();

  // Set up request-level context for the entire request handling lifecycle.
  // This provides basic metadata (requestID, spanID, logToken) for logs emitted
  // outside function execution.
  const requestContext: RequestContext = {
    requestID: id ?? "",
    spanID: spanID ?? "",
    logToken: logToken ?? "",
    abortExecution: (reason: unknown) => executionController.abort(reason),
  };

  return requestStore.run(
    requestContext,
    () =>
      handleRequestInContext(req, getFunctions, {
        bundleManifest,
        fetchRewrites,
        rawLogger,
        requestContext,
        requestTimeout,
        executionController,
        annotations,
      }),
  );
};

const handleRequestInContext = async (
  req: Request,
  getFunctions: () => Promise<Functions>,
  {
    bundleManifest,
    fetchRewrites,
    rawLogger = console.log,
    requestTimeout = 0,
    executionController = new AbortController(),
    requestContext,
    annotations,
  }: HandleRequestOptions = {},
) => {
  const id = req.headers.get(InternalHeaders.RequestID);
  const logToken = req.headers.get(InternalHeaders.LogToken);
  const environment = getEnvironment();
  const logger = detachedLogger.withRequestID(id).withLogToken(logToken);
  if (requestContext) {
    requestContext.logger = logger;
  }
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
  const timeoutSignal = requestTimeout
    ? AbortSignal.timeout(requestTimeout)
    : undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    executionController.signal.addEventListener("abort", () => {
      reject(executionController.signal.reason);
    });
  });

  try {
    const functionNamesHeader = req.headers.get(InternalHeaders.EdgeFunctions);

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
    } else {
      // In production, we want to ensure that all requests are made over
      // HTTPS
      if (url.protocol === "http:") {
        url.protocol = "https:";
      }
    }

    const edgeReq = new EdgeRequest(new Request(url, req));

    setFeatureFlags(edgeReq, featureFlags);

    // We don't want to run the same function multiple times in the same chain,
    // so we deduplicate the function names while preserving their order.
    const functionNames = [...new Set(functionNamesHeader.split(","))];

    const reqLogger = getLogger(edgeReq).withFields({
      cache_mode: getCacheMode(edgeReq),
      feature_flags: Object.keys(getFeatureFlags(edgeReq)),
      function_names: functionNames,
      url: req.url,
    });
    if (requestContext) {
      // upgrade logger with additional fields
      requestContext.logger = reqLogger;
    }

    if (annotations) {
      const annotationSiteId = annotations.site_id;
      const siteIdFromHeader = getSite(edgeReq).id;
      const isSiteIdMismatched = annotationSiteId &&
        siteIdFromHeader &&
        annotationSiteId !== siteIdFromHeader;

      const annotationAccountId = annotations.account_id;
      const accountIdFromHeader = getAccount(edgeReq).id;
      const isAccountIdMismatched = annotationAccountId &&
        accountIdFromHeader &&
        annotationAccountId !== accountIdFromHeader;

      if (isSiteIdMismatched || isAccountIdMismatched) {
        reqLogger
          .withFields({
            annotation_account_id: annotationAccountId,
            mismatched_account_id: isAccountIdMismatched,
            annotation_site_id: annotationSiteId,
            mismatched_site_id: isSiteIdMismatched,
          })
          .error(
            "site_id or account_id mismatch between annotations and request headers",
          );

        if (featureFlags[FeatureFlag.ErrorOnSiteOrAccountMismatch]) {
          return new Response("Internal Server Error", {
            status: 500,
            headers: {
              [InternalHeaders.PlatformError]: JSON.stringify({
                code: "site_or_account_id_mismatch",
                message: "An unexpected error occurred",
              }),
            },
          });
        }
      }
    }

    injectEnvironmentVariablesFromHeader(edgeReq);

    // Populate early AI environment variables before loading functions.
    // This allows AI SDK clients to be initialized in top-level scope with
    // AIG base URLs when AIG is enabled.
    populateEarlyAIEnvironment(edgeReq);

    let didLoadFunctionsForCurrentRequest = false;
    if (!functions) {
      const getFunctionsStartTime = performance.now();

      functions = await Promise.race([getFunctions(), abortPromise]);

      didLoadFunctionsForCurrentRequest = true;
      getFunctionsDuration = performance.now() - getFunctionsStartTime;
    }

    populateEnvironment(edgeReq);

    const cacheAPIToken = getCacheAPIToken(edgeReq);
    const cacheAPIURL = getCacheAPIURL(edgeReq);

    const requestInvocationMetadata = parseRequestInvocationMetadata(
      req.headers.get(InternalHeaders.InvocationMetadata),
    );
    const router = new Router(
      functions,
      requestInvocationMetadata,
      bundleManifest,
    );

    const chain = new FunctionChain({
      executionController,
      functionNames,
      initialMetrics: metrics,
      rawLogger,
      request: edgeReq,
      router,
      timeoutSignal,
    });

    reqLogger
      .withFields({
        cache_api_token: Boolean(cacheAPIToken),
        cache_api_url: Boolean(cacheAPIURL),
      })
      .debug("Started processing edge function request");

    const startTime = performance.now();
    const response = await Promise.race([
      timeoutSignal ? chain.runWithSignal() : chain.run(),
      abortPromise,
    ]);

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
      .withFields({
        ef_duration: endTime - startTime,
        ...(isNimble
          ? {
            // to differentiate whether function loading happened for this request or happened before
            // different field name is used to avoid confusion
            [
              didLoadFunctionsForCurrentRequest
                ? "load_functions_duration_current"
                : "load_functions_duration_initial"
            ]: getFunctionsDuration,
          }
          : {}),
      })
      .debug("Finished processing edge function request");

    if (isNimble && featureFlags[FeatureFlag.NimbleLogVMStats]) {
      const memoryUsage = Deno.memoryUsage();
      reqLogger
        .withFields({
          rss: (memoryUsage.rss / MB).toFixed(0),
          heap_total: (memoryUsage.heapTotal / MB).toFixed(0),
          heap_used: (memoryUsage.heapUsed / MB).toFixed(0),
          external: (memoryUsage.external / MB).toFixed(0),
        })
        .log("Nimble deno VM memory usage");
    }

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
      } else if (error !== null && typeof error === "object") {
        try {
          fields.error_message = JSON.stringify(error) ?? String(error);
        } catch {
          fields.error_message = String(error);
        }
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

  if (error instanceof UnhandledRejectionError) {
    return "unhandled_rejection";
  }

  if (
    error instanceof Error &&
    (error?.name === "AbortError" || error?.name === "TimeoutError")
  ) {
    return "timeout";
  }

  return "1";
};

export const resetModuleState = () => {
  setHasPopulatedEnvironment(false);
  resetInitialEnv();
  functions = null;
};
