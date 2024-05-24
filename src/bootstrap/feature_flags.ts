import { EdgeRequest, getFeatureFlags } from "./request.ts";

export type FeatureFlags = Record<string, boolean>;

export enum FeatureFlag {
  FailureModes = "edge_functions_bootstrap_failure_mode",
  LogCacheControl = "edge_functions_bootstrap_log_cache_control",
  RunFunctionsOnFetch = "edge_functions_bootstrap_run_functions_fetch",
  WarnContextNext = "edge_functions_bootstrap_warn_context_next",
  PathParams = "edge_functions_bootstrap_parse_path_params",
  PopulateEnvironment = "edge_functions_bootstrap_populate_environment",
  DecodeQuery = "edge_functions_bootstrap_decode_query",
  ForceNoTransform = "edge_functions_bootstrap_force_no_transform",
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
