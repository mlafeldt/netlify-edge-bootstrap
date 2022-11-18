enum Headers {
  Geo = "x-nf-geo",
  SiteInfo = "x-nf-site-info",
  AccountInfo = "x-nf-account-info",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  Functions = "x-deno-functions",
  Passthrough = "x-deno-pass",
  PassthroughHost = "x-nf-passthrough-host",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
  UncaughtError = "x-nf-uncaught-error",
  FeatureFlags = "x-nf-feature-flags",
  EdgeFunctionBypass = "x-nf-edge-function-bypass",
  PassthroughTiming = "x-nf-passthrough-timing",
  DebugLogging = "x-nf-debug-logging",
  CacheControl = "cache-control",
}

export default Headers;

export const conditionals = [
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
];
