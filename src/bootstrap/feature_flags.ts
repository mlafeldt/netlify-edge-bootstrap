import { EdgeRequest, getFeatureFlags } from "./request.ts";

export type FeatureFlags = Record<string, boolean>;

export enum FeatureFlag {
  DecodeQuery = "edge_functions_bootstrap_decode_query",
  ForwardRequestID = "edge_functions_bootstrap_forward_request_id",
  ForceHTTP11 = "edge_functions_bootstrap_force_http11",
  UseOneClientPoolPerIsolate =
    "edge_functions_bootstrap_use_one_client_pool_per_isolate",
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
