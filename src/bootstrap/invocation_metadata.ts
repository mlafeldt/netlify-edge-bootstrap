interface FunctionConfig {
  excluded_patterns?: string[] | null;
  on_error?: string;
}
export interface InvocationMetadata {
  function_config?: Record<string, FunctionConfig>;
  routes?: { function: string; pattern: string }[] | null;
}

// Parses the header with invocation metadata sent by our edge nodes. It holds
// a Base64-encoded JSON string with the list of all routes and configuration.
export function parseInvocationMetadata(
  routingHeader: string | null,
) {
  if (!routingHeader) {
    return {};
  }

  try {
    const routingData: InvocationMetadata = JSON.parse(atob(routingHeader));

    return routingData;
  } catch {
    throw new Error("Could not parse edge functions invocation metadata");
  }
}
