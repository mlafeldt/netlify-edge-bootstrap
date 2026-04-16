import type { FunctionConfig, Route } from "./bundle_manifest.ts";

export interface RequestInvocationMetadata {
  function_config?: Record<string, FunctionConfig>;
  req_routes?: number[];
  routes?: Route[] | null;
  is_post_cache?: boolean;
}

// Parses the header with invocation metadata sent by our edge nodes. It holds
// a Base64-encoded JSON string with the list of all routes and configuration.
export function parseRequestInvocationMetadata(routingHeader: string | null) {
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
