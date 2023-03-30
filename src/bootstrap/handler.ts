import { isCacheable } from "./cache.ts";
import { FeatureFlag, hasFlag } from "./feature_flags.ts";
import { FunctionChain } from "./function_chain.ts";
import { Logger } from "./log/instrumented_log.ts";
import { logger as systemLogger } from "./log/logger.ts";
import {
  EdgeRequest,
  getCacheMode,
  getFeatureFlags,
  getPassthroughHeaders,
} from "./request.ts";
import { getEnvironment } from "./environment.ts";
import { InternalHeaders, mutateHeaders, StandardHeaders } from "./headers.ts";
import { parseInvocationMetadata } from "./invocation_metadata.ts";
import { requestStore } from "./request_store.ts";
import { Router } from "./router.ts";
import type { Functions } from "./stage_2.ts";
import { ErrorType, UserError } from "./util/errors.ts";

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
  const logger = systemLogger.withRequestID(id);

  try {
    const functionNamesHeader = req.headers.get(InternalHeaders.EdgeFunctions);
    const metadata = parseInvocationMetadata(
      req.headers.get(InternalHeaders.InvocationMetadata),
    );
    const router = new Router(functions, metadata, logger);

    if (id == null || functionNamesHeader == null) {
      return new Response(
        "Request must have headers for request ID and functions names",
        {
          status: 400,
          headers: { [StandardHeaders.ContentType]: "text/plain" },
        },
      );
    }

    // A collector of all the functions invoked by this chain or any sub-chains
    // that it triggers.
    const invokedFunctions: string[] = [];

    const functionNames = functionNamesHeader.split(",");
    const edgeReq = new EdgeRequest(req);
    const chain = new FunctionChain({
      functionNames,
      invokedFunctions,
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
        .log("Started edge function invocation");
    }

    const startTime = performance.now();
    const response = await chain.run();

    // Propagate headers received from passthrough calls to the final response.
    getPassthroughHeaders(edgeReq).forEach((value, key) => {
      if (response.headers.has(key)) {
        logger
          .withFields({ header: key })
          .log("user-defined header overwritten by passthrough header");
      }

      response.headers.set(key, value);
    });

    const endTime = performance.now();

    if (req.headers.get(InternalHeaders.DebugLogging)) {
      logger
        .withFields({ ef_duration: endTime - startTime })
        .log("Finished edge function invocation");
    }

    const cacheControl = response.headers.get(StandardHeaders.CacheControl);
    const shouldLogCacheControl = hasFlag(
      edgeReq,
      FeatureFlag.LogCacheControl,
    );

    if (shouldLogCacheControl && isCacheable(cacheControl)) {
      logger
        .withFields({
          cache_control: cacheControl,
          mode: getCacheMode(edgeReq),
        })
        .log("Edge function returned cacheable cache-control headers");
    }

    if (hasFlag(edgeReq, FeatureFlag.InvokedFunctionsHeader)) {
      return mutateHeaders(response, (headers) => {
        headers.set(
          InternalHeaders.EdgeFunctions,
          invokedFunctions.join(","),
        );
      });
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
