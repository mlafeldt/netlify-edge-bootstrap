import type { FunctionChain } from "./function_chain.ts";

type RequestID = string;
type RequestStore = Map<RequestID, FunctionChain>;

export const requestStore: RequestStore = new Map();

// Takes a response and a request ID and returns an equivalent response with a
// body wrapped in a `TransformStream` that will automatically remove the given
// request ID from the request store once the body has been consumed.
export const getResponseWithRequestStoreCleanup = (
  response: Response,
  id: string,
) => {
  // If there's no body, we can delete the request right away.
  if (!response.body) {
    requestStore.delete(id);

    return response;
  }

  const transform = new TransformStream({
    flush() {
      requestStore.delete(id);
    },
  });

  return new Response(response.body.pipeThrough(transform), response);
};
