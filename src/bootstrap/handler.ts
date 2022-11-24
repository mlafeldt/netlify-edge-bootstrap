import { FunctionChain } from "./function_chain.ts";
import { EdgeFunction } from "./edge_function.ts";
import { Logger } from "./log/log_location.ts";
import { logger } from "./log/logger.ts";
import { EdgeRequest, getMode, getPassthroughTiming } from "./request.ts";
import { InternalHeaders, StandardHeaders } from "./headers.ts";
import { getEnvironment } from "./environment.ts";

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
    const functionNames = req.headers.get(InternalHeaders.Functions);

    if (id == null || functionNames == null) {
      return new Response(
        "Request must have headers for request ID and functions names",
        {
          status: 400,
          headers: { "content-type": "text/plain" },
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

    // Whenever someone invokes an edge function that has cache-control headers set
    // we log it so we understand the usage better.
    if (environment !== "local") {
      if (response.headers.has(StandardHeaders.CacheControl)) {
        logger
          .withFields({
            ef_cache_control: response.headers.get(
              StandardHeaders.CacheControl,
            ),
            ef_mode: getMode(edgeReq),
          })
          .withRequestID(id)
          .log("Edge function invoked with cache-control header");
      }
    }

    return response;
  } catch (error) {
    let errorString = String(error);

    if (environment === "local") {
      errorString = JSON.stringify({
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    } else if (environment === "production") {
      logger
        .withFields({
          error_name: error.name,
          error_message: error.message,
          error_stack: error.stack,
        })
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
