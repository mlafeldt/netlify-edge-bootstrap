import { EdgeRequest, getFeatureFlags } from "./request.ts";

export type FeatureFlags = Record<string, boolean>;

export enum FeatureFlag {
  FailureModes = "edge_functions_bootstrap_failure_mode",
  InvokedFunctionsHeader = "edge_functions_bootstrap_invoked_functions_header",
  LogCacheControl = "edge_functions_bootstrap_log_cache_control",
  Netliblob = "edge_functions_bootstrap_netliblob",
  RunFunctionsOnFetch = "edge_functions_bootstrap_run_functions_fetch",
  StripContentLength = "edge_functions_bootstrap_strip_content_length",
  WarnContextNext = "edge_functions_bootstrap_warn_context_next",
  PathParams = "edge_functions_bootstrap_parse_path_params",
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
