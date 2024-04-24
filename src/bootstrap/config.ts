type Cache = "off" | "manual";

type Path = `/${string}`;

type OnError = "fail" | "bypass" | Path;

type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

/**
 * Netlify Edge Function inline configuration options.
 *
 * @see {@link https://docs.netlify.com/edge-functions/declarations/#declare-edge-functions-inline}
 */
export interface Config {
  cache?: Cache;
  excludedPath?: Path | Path[];
  excludedPattern?: string | string[];
  onError?: OnError;
  path?: Path | Path[];
  pattern?: string | string[];
  method?: HTTPMethod | HTTPMethod[];
}

/**
 * Framework-generated Netlify Edge Function inline configuration options.
 *
 * @see {@link https://docs.netlify.com/edge-functions/create-integration/#generate-declarations}
 */
export interface IntegrationsConfig extends Config {
  name?: string;
  generator?: string;
}

/**
 * A function configuration in the `manifest.json` file for framework-generated Netlify
 * Edge Functions.
 *
 * @see {@link https://docs.netlify.com/edge-functions/declarations/#declare-edge-functions-inline}
 */
export interface ManifestFunction extends Config {
  function: string;
}

/**
 * The `manifest.json` file for framework-generated Netlify Edge Functions.
 *
 * @see {@link https://docs.netlify.com/edge-functions/create-integration/#generate-declarations}
 */
export interface Manifest {
  version: 1;
  functions: ManifestFunction[];
  import_map?: string;
}
