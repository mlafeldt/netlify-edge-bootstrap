import { EdgeRequest, getFeatureFlags } from "./request.ts";

export type FeatureFlags = Record<string, boolean>;

export enum FeatureFlag {
  RunFunctionsOnFetch = "edge_functions_bootstrap_run_functions_fetch",
  DecodeQuery = "edge_functions_bootstrap_decode_query",
  ForwardRequestID = "edge_functions_bootstrap_forward_request_id",
  ForwardCDNLoop = "edge_functions_bootstrap_forward_cdn_loop",
  InvocationTimeout = "edge_functions_bootstrap_invocation_timeout",
  DedupeFunctions = "edge_functions_bootstrap_deduplicate_functions",
  CacheAPI = "edge_functions_bootstrap_cache_api",
}

export const hasFlag = (req: EdgeRequest, flag: FeatureFlag) => {
  const featureFlags = getFeatureFlags(req);

  return Boolean(featureFlags[flag]);
};

export function parseFeatureFlagsHeader(
  header: string | null,
): FeatureFlags {
  if (!header) {
    return {};
  }

  try {
    const json = atob(header);
    return JSON.parse(json);
  } catch (_error) {
    return {};
  }
}
