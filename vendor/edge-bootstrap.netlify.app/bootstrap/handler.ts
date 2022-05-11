import { FunctionChain } from "./function_chain.ts";
import { EdgeFunction } from "./edge_function.ts";
import { EdgeRequest } from "./request.ts";
import Headers from "./headers.ts";
const handleRequest = async (
  req: Request,
  functions: Record<string, EdgeFunction>,
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
    const chain = new FunctionChain({
      functions: requestFunctions,
      request: edgeReq,
    });
    const response = await chain.run();

    return response;
  } catch (e) {
    console.error(e);
    return new Response(`Error: ${e}`, { status: 500 });
  }
};

export { handleRequest };
