export enum InternalHeaders {
  AIGateway = "x-nf-ai-gateway",
  AIGatewayLegacy = "x-nf-ai-gateway-token",
  BlobsInfo = "x-nf-blobs-info",
  CacheAPIToken = "x-nf-pc-token",
  CacheAPIURL = "x-nf-pc-url",
  Country = "x-country",
  DeployID = "x-nf-deploy-id",
  DeployContext = "x-nf-deploy-context",
  DeployIsPublished = "x-nf-deploy-published",
  Geo = "x-nf-geo",
  SiteInfo = "x-nf-site-info",
  AccountInfo = "x-nf-account-info",
  ForwardedHost = "x-forwarded-host",
  ForwardedProtocol = "x-forwarded-proto",
  EdgeFunctions = "x-nf-edge-functions",
  Passthrough = "x-nf-passthrough",
  PassthroughHost = "x-nf-passthrough-host",
  PassthroughProtocol = "x-nf-passthrough-proto",
  RequestID = "x-nf-request-id",
  IP = "x-nf-client-connection-ip",
  UncaughtError = "x-nf-uncaught-error",
  FeatureFlags = "x-nf-feature-flags",
  EdgeFunctionBypass = "x-nf-edge-function-bypass",
  DebugLogging = "x-nf-debug-logging",
  InvocationMetadata = "x-nf-edge-functions-metadata",
  EdgeFunctionCache = "x-nf-edge-function-cache",
  LegacyEdgeFunctions = "x-deno-functions",
  LegacyPassthrough = "x-deno-pass",
  ATSVersion = "x-nf-ats-version",
  CacheResult = "x-nf-cache-result",
  BBCache = "x-bb-cache",
  BBSiteCancelled = "x-bb-site-cancelled",
  BBProxyType = "x-bb-proxy-type",
  FunctionType = "x-nf-function-type",
  FunctionID = "x-nf-func-id",
  BlockReason = "x-nf-block-reason",
  PassthroughTiming = "x-nf-passthrough-timing",
  PurgeAPIToken = "x-nf-purge-api-token",
  FetchTiming = "x-nf-fetch-timing",
  FetchCacheStatus = "x-nf-fetch-cache-status",
  InvocationMetrics = "x-nf-invocation-metrics",
  NFTraceSpanID = "x-nf-trace-span-id",
  NFEdgeFuncEnv = "x-nf-edge-function-env",
  LogToken = "x-nf-edge-function-log-token",
  SkewProtectionToken = "x-nf-skew-protection-token",
}

export enum StandardHeaders {
  CacheControl = "cache-control",
  CDNLoop = "cdn-loop",
  ContentLength = "content-length",
  ContentType = "content-type",
  Via = "via",
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

export const hasMutatedHeaders = (before: Headers, after: Headers) => {
  const diff = getDiff(before, after);

  return Object.keys(diff).length !== 0;
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

// Convenience method for safely mutating the headers in a response, even when
// their guard is set to `immutable`, which is the case when the response was
// produced by a `fetch` call. See:
// https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#guard
export const mutateHeaders = (
  res: Response,
  callback: (headers: Headers) => void,
) => {
  const newRes = new Response(res.body, res);

  callback(newRes.headers);

  return newRes;
};

export const isInternalHeader = (name: string) =>
  name.startsWith("x-nf-") ||
  name.startsWith("x-deno-") ||
  name.startsWith("x-bb-");
