enum Headers {
  Geo = "x-nf-geo",
  Site = "x-nf-site-info",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  Functions = "x-deno-functions",
  Passthrough = "x-deno-pass",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
  UncaughtError = "x-nf-uncaught-error",
}

export default Headers;

export const conditionals = [
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
];
