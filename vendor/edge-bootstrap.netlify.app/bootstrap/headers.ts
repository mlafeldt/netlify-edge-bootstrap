enum Headers {
  Geo = "x-nf-geo",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  Functions = "x-deno-functions",
  Passthrough = "x-deno-pass",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
}

export default Headers;

export const conditionals = [
  "if-match",
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-range",
];
