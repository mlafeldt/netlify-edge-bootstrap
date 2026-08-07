import { EdgeRequest, getFeatureFlags } from "./request.ts";

export type FeatureFlags = Record<string, boolean>;

export enum FeatureFlag {
  LogHTMLRewriter = "edge_functions_bootstrap_log_html_rewriter",
  UseOneClientPoolPerIsolate =
    "edge_functions_bootstrap_use_one_client_pool_per_isolate",
  ErrorOnSiteOrAccountMismatch =
    "edge_functions_bootstrap_error_on_site_or_account_mismatch",
  NimbleLogVMStats = "edge_functions_bootstrap_nimble_log_vm_stats",
}

export const hasFlag = (req: EdgeRequest, flag: FeatureFlag) => {
  const featureFlags = getFeatureFlags(req);

  return Boolean(featureFlags[flag]);
};

export function parseFeatureFlagsHeader(header: string | null): FeatureFlags {
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
