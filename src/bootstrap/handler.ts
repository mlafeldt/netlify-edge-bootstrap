import { FunctionChain } from "./function_chain.ts";
import { EdgeFunction } from "./edge_function.ts";
import { Logger } from "./log/log_location.ts";
import {
  EdgeRequest,
  getFeatureFlags,
  getPassthroughTiming,
} from "./request.ts";
import Headers from "./headers.ts";
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
  const id = req.headers.get(Headers.RequestID);

  try {
    const passthrough = req.headers.get(Headers.Passthrough);
    const functionsHeader = req.headers.get(Headers.Functions);

    if (passthrough == null || id == null || functionsHeader == null) {
      return new Response(
        "Request must have passthrough header, request ID and request functions",
        {
          status: 400,
          headers: { "content-type": "text/plain" },
        },
      );
    }

    const requestFunctions = functionsHeader.split(",").map((name) => ({
      name,
      function: functions[name],
    }));
    const edgeReq = new EdgeRequest(req);
    const flags = getFeatureFlags(edgeReq);

    if (flags.edge_functions_bootstrap_enable_request_store) {
      requestStore.set(id, edgeReq);
    }

    const chain = new FunctionChain({
      functions: requestFunctions,
      rawLogger,
      request: edgeReq,
    });
    const response = await chain.run();

    // If we talked to origin and we got a timing header back, let's propagate it to
    // the final response.
    const passthroughTiming = getPassthroughTiming(edgeReq);
    if (passthroughTiming) {
      response.headers.set(Headers.PassthroughTiming, passthroughTiming);
    }

    return response;
  } catch (error) {
    let errorString = String(error);

    const environment = getEnvironment();

    if (environment === "local") {
      errorString = JSON.stringify({
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
    }

    return new Response(errorString, {
      status: 500,
      headers: {
        [Headers.UncaughtError]: "1",
      },
    });
  } finally {
    if (id) {
      requestStore.delete(id);
    }
  }
};

export { handleRequest };
