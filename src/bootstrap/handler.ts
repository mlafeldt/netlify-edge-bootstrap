import { isCacheable } from "./cache.ts";
import { FunctionChain } from "./function_chain.ts";
import { Logger } from "./log/instrumented_log.ts";
import { logger } from "./log/logger.ts";
import {
  EdgeRequest,
  getCacheMode,
  getFeatureFlags,
  getPassthroughHeaders,
  hasFeatureFlag,
} from "./request.ts";
import { getEnvironment } from "./environment.ts";
import { InternalHeaders, StandardHeaders } from "./headers.ts";
import { parseInvocationMetadata } from "./invocation_metadata.ts";
import { requestStore } from "./request_store.ts";
import { Router } from "./router.ts";
import type { Functions } from "./stage_2.ts";
import { ErrorType, UnhandledFunctionError } from "./util/errors.ts";

interface HandleRequestOptions {
  rawLogger?: Logger;
}

const handleRequest = async (
  req: Request,
  functions: Functions,
  { rawLogger = console.log }: HandleRequestOptions = {},
) => {
  const id = req.headers.get(InternalHeaders.RequestID);
  const environment = getEnvironment();

  try {
    const functionNamesHeader = req.headers.get(InternalHeaders.EdgeFunctions);
    const metadata = parseInvocationMetadata(
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

    const functionNames = functionNamesHeader.split(",");
    const edgeReq = new EdgeRequest(req);
    const chain = new FunctionChain({
      functionNames,
      rawLogger,
      request: edgeReq,
      router,
    });

    requestStore.set(id, chain);

    if (req.headers.get(InternalHeaders.DebugLogging)) {
      logger
        .withFields({
          feature_flags: Object.keys(getFeatureFlags(edgeReq)),
          function_names: functionNames,
          mode: getCacheMode(edgeReq),
        })
        .withRequestID(id)
        .log("Started edge function invocation");
    }

    const startTime = performance.now();

    const response = await chain.run();

    // Propagate headers received from passthrough calls to the final response.
    getPassthroughHeaders(edgeReq).forEach((value, key) => {
      if (response.headers.has(key)) {
        logger
          .withFields({ header: key })
          .withRequestID(id)
          .log("user-defined header overwritten by passthrough header");
      }

      response.headers.set(key, value);
    });

    const endTime = performance.now();

    if (req.headers.get(InternalHeaders.DebugLogging)) {
      logger
        .withFields({ ef_duration: endTime - startTime })
        .withRequestID(id)
        .log("Finished edge function invocation");
    }

    const cacheControl = response.headers.get(StandardHeaders.CacheControl);
    const shouldLogCacheControl = hasFeatureFlag(
      edgeReq,
      "edge_functions_bootstrap_log_cache_control",
    );

    if (shouldLogCacheControl && isCacheable(cacheControl)) {
      logger
        .withFields({
          cache_control: cacheControl,
          mode: getCacheMode(edgeReq),
        })
        .withRequestID(id)
        .log("Edge function returned cacheable cache-control headers");
    }

    return response;
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
        const errorType = error instanceof UnhandledFunctionError
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
        .withRequestID(id)
        .log("uncaught exception while handling request");
    }

    return new Response(errorString, {
      status: 500,
      headers: {
        [InternalHeaders.UncaughtError]: "1",
      },
    });
  } finally {
    if (id) {
      requestStore.delete(id);
    }
  }
};

export { handleRequest };
