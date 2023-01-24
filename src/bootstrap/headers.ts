export enum InternalHeaders {
  Geo = "x-nf-geo",
  SiteInfo = "x-nf-site-info",
  AccountInfo = "x-nf-account-info",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  EdgeFunctions = "x-nf-edge-functions",
  /** @deprecated */
  DenoFunctions = "x-deno-functions",
  Passthrough = "x-nf-passthrough",
  /** @deprecated */
  DenoPassthrough = "x-deno-pass",
  PassthroughHost = "x-nf-passthrough-host",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
  UncaughtError = "x-nf-uncaught-error",
  FeatureFlags = "x-nf-feature-flags",
  EdgeFunctionBypass = "x-nf-edge-function-bypass",
  PassthroughTiming = "x-nf-passthrough-timing",
  DebugLogging = "x-nf-debug-logging",
}

export enum StandardHeaders {
  CacheControl = "cache-control",
  ContentType = "content-type",
}

export const conditionals = [
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
];

export const serialize = (headers: Headers) => {
  const headersObj: Record<string, string> = {};

  headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  return JSON.stringify(headersObj);
};
