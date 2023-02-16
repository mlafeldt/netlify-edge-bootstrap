export enum InternalHeaders {
  Geo = "x-nf-geo",
  SiteInfo = "x-nf-site-info",
  AccountInfo = "x-nf-account-info",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  EdgeFunctions = "x-nf-edge-functions",
  Passthrough = "x-nf-passthrough",
  PassthroughHost = "x-nf-passthrough-host",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
  UncaughtError = "x-nf-uncaught-error",
  FeatureFlags = "x-nf-feature-flags",
  EdgeFunctionBypass = "x-nf-edge-function-bypass",
  PassthroughTiming = "x-nf-passthrough-timing",
  DebugLogging = "x-nf-debug-logging",
  InvocationMetadata = "x-nf-edge-functions-metadata",
  EdgeFunctionCache = "x-nf-edge-function-cache",
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

// Returns the diff between two sets of headers as an object:
// - If a header has been added or modified, it will show in the diff object
//   with its new value
// - If a header has been deleted, it will show in the diff object with an
//   empty string
// - If a header has not been modified, it will not show in the diff object
export const getDiff = (before: Headers, after: Headers) => {
  const diff: Record<string, string> = {};

  after.forEach((value, key) => {
    if (before.get(key) !== value) {
      diff[key] = value;
    }
  });

  before.forEach((_, key) => {
    if (!after.has(key)) {
      diff[key] = "";
    }
  });

  return diff;
};

export const serialize = (headers: Headers) => {
  const headersObject: Record<string, string[]> = {};

  headers.forEach((value, name) => {
    // `set-cookie` is a special case where multiple values exist for the same
    // key, as opposed to being comma-separated on a single key.
    // https://github.com/whatwg/fetch/issues/973
    const values = name === "set-cookie" ? [value] : value.split(", ");

    values.forEach((value) => {
      headersObject[name] = [...(headersObject[name] || []), value];
    });
  });

  return headersObject;
};
