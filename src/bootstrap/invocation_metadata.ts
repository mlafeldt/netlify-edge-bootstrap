export interface FunctionConfig {
  excluded_patterns?: string[] | null;
  generator?: string;
  on_error?: string;
}
export interface RequestInvocationMetadata {
  function_config?: Record<string, FunctionConfig>;
  req_routes?: number[];
  routes?: {
    function: string;
    path?: string;
    pattern: string;
    methods?: string[];
  }[] | null;
}

// Parses the header with invocation metadata sent by our edge nodes. It holds
// a Base64-encoded JSON string with the list of all routes and configuration.
export function parseRequestInvocationMetadata(
  routingHeader: string | null,
) {
  if (!routingHeader) {
    return {};
  }

  try {
    const routingData: RequestInvocationMetadata = JSON.parse(
      atob(routingHeader),
    );

    return routingData;
  } catch {
    throw new Error("Could not parse edge functions invocation metadata");
  }
}
