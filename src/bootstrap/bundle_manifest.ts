export interface FunctionConfig {
  excluded_patterns?: string[] | null;
  generator?: string;
  on_error?: string;
}

export interface Route {
  function: string;
  path?: string;
  pattern: string;
  methods?: string[];
  header?: Record<string, boolean | string>;
}

export interface BundleManifestConfig {
  function_config: Record<string, FunctionConfig>;
  routes: Route[];
  post_cache_routes: Route[];
}

interface BundleManifestBase {
  functions: Record<string, string>;
  version: number;
}

type BundleManifestV1 = BundleManifestBase & {
  version: 1;
};

type BundleManifestV2 = BundleManifestBase & {
  version: 2;
} & BundleManifestConfig;

export type BundleManifest = BundleManifestV1 | BundleManifestV2;
