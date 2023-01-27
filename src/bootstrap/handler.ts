import { FunctionChain } from "./function_chain.ts";
import { EdgeFunction } from "./edge_function.ts";
import { Logger } from "./log/instrumented_log.ts";
import { logger } from "./log/logger.ts";
import {
  EdgeRequest,
  getFeatureFlags,
  getMode,
  getPassthroughTiming,
  hasFeatureFlag,
} from "./request.ts";
import { InternalHeaders, StandardHeaders } from "./headers.ts";
import { getEnvironment } from "./environment.ts";
import { isCacheable } from "./cache.ts";

interface HandleRequestOptions {
  rawLogger?: Logger;
}
export const requestStore = new Map<string, EdgeRequest>();

const handleRequest = async (
  req: Request,
  functions: Record<string, EdgeFunction>,
  { rawLogger }: HandleRequestOptions = {},
) => {
  const id = req.headers.get(InternalHeaders.RequestID);
  const environment = getEnvironment();

  try {
    const functionNames = req.headers.get(InternalHeaders.EdgeFunctions);

    if (id == null || functionNames == null) {
      return new Response(
        "Request must have headers for request ID and functions names",
        {
          status: 400,
          headers: { [StandardHeaders.ContentType]: "text/plain" },
        },
      );
    }

    const requestFunctions = functionNames.split(",").map((name) => ({
      name,
      function: functions[name],
    }));
    const edgeReq = new EdgeRequest(req);

    requestStore.set(id, edgeReq);

    if (req.headers.get(InternalHeaders.DebugLogging)) {
      logger
        .withFields({
          feature_flags: Object.keys(getFeatureFlags(edgeReq)),
          function_names: functionNames,
          mode: getMode(edgeReq),
        })
        .withRequestID(id)
        .log("Started edge function invocation");
    }

    const chain = new FunctionChain({
      functions: requestFunctions,
      rawLogger,
      request: edgeReq,
    });
    const startTime = performance.now();
    const response = await chain.run();

    // If we talked to origin and we got a timing header back, let's propagate it to
    // the final response.
    const passthroughTiming = getPassthroughTiming(edgeReq);
    if (passthroughTiming) {
      response.headers.set(
        InternalHeaders.PassthroughTiming,
        passthroughTiming,
      );
    }

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
          mode: getMode(edgeReq),
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
        fields = {
          error_name: error.name,
          error_message: error.message,
          error_stack: error.stack,
          error_cause: String(error.cause),
        };
      } else {
        fields = {
          error_message: String(error),
        };
      }

      logger.withFields(fields).withRequestID(id).log(
        "uncaught exception while handling request",
      );
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
