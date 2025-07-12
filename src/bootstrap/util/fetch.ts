import { FeatureFlag, hasFlag } from "../feature_flags.ts";
import { InternalHeaders, StandardHeaders } from "../headers.ts";
import { detachedLogger } from "../log/logger.ts";
import { internalsSymbol, PassthroughRequest } from "../request.ts";
import { getExecutionContextAndLogFailure } from "./execution_context.ts";

/**
 * Takes the first argument of a `fetch()` call and returns a URL object that
 * represents the request URL.
 */
export const getFetchURL = (input: string | URL | Request) => {
  if (input instanceof URL) {
    return input;
  }

  return new URL(typeof input === "string" ? input : input.url);
};

const safelyGetFetchURL = (input: string | URL | Request) => {
  try {
    return getFetchURL(input);
  } catch {
    // no-op
  }
};

export const patchFetchToTrackSubrequests = (
  rawFetch: typeof globalThis.fetch,
) => {
  return async (...args: Parameters<typeof globalThis.fetch>) => {
    // For passthrough requests, we inject the `ABortSignal` and track the
    // duration manually upstream.
    if (args[0] instanceof PassthroughRequest) {
      return rawFetch(...args);
    }

    const url = safelyGetFetchURL(args[0]);

    if (url === undefined) {
      detachedLogger.withFields({ args }).error(
        "Could not get URL from arguments in fetch call",
      );

      return rawFetch(...args);
    }

    const executionContext = getExecutionContextAndLogFailure(
      "track-subrequests",
    );

    if (executionContext?.chain === undefined) {
      return rawFetch(...args);
    }

    const { chain } = executionContext;

    // @ts-ignore-error Deno 2.0 flags this as a type error even though `signal`
    // is part of `RequestInit`. More context:
    // https://netlify.slack.com/archives/C0359548J07/p1732894713803429
    const { signal: userSignal } = args[1] ?? {};
    const { signal: chainSignal } = chain.executionController;
    const signal = AbortSignal.any(
      [userSignal, chainSignal].filter(Boolean) as AbortSignal[],
    );

    args[1] = { ...args[1], signal };

    const call = chain.metrics.startFetch(url.host);

    try {
      const result = await rawFetch(...args);

      return result;
    } finally {
      call.end();
    }
  };
};

// Returns a patched version of `fetch` that rewrites URLs based on the origin
// before issuing the actual HTTP request.
export const patchFetchWithRewrites = (
  rawFetch: typeof globalThis.fetch,
  rewrites: Map<string, string>,
) => {
  return (input: URL | Request | string, init?: RequestInit) => {
    let url: URL;

    if (input instanceof URL) {
      url = input;
    } else if (typeof input === "string") {
      url = new URL(input);
    } else if (input instanceof Request) {
      url = new URL(input.url);
    } else {
      // We should only get here if the caller has used an invalid type. In
      // that case, let the regular `fetch` logic handle it.
      return rawFetch(input, init);
    }

    const newOrigin = rewrites.get(url.origin);

    if (newOrigin === undefined) {
      return rawFetch(input, init);
    }

    const newURL = new URL(url.pathname + url.search + url.hash, newOrigin);

    if (input instanceof Request) {
      const newRequest = new Request(newURL, input);

      return rawFetch(newRequest, init);
    }

    return rawFetch(newURL, init);
  };
};

// Returns a patched version of `fetch` that adds headers to outgoing requests.
export const patchFetchToForwardHeaders = (
  rawFetch: typeof globalThis.fetch,
) => {
  return (input: URL | Request | string, init?: RequestInit) => {
    // For passthrough requests, we manually append the headers upstream.
    if (input instanceof PassthroughRequest) {
      return rawFetch(input, init);
    }

    const executionContext = getExecutionContextAndLogFailure(
      "forward-headers",
    );
    if (executionContext?.chain === undefined) {
      return rawFetch(input, init);
    }

    const { chain } = executionContext;
    const request = new Request(input, init);
    const { cdnLoop, requestID } = chain.request[internalsSymbol];

    if (requestID && hasFlag(chain.request, FeatureFlag.ForwardRequestID)) {
      request.headers.set(InternalHeaders.RequestID, requestID);
    }

    if (cdnLoop && hasFlag(chain.request, FeatureFlag.ForwardCDNLoop)) {
      request.headers.append(StandardHeaders.CDNLoop, cdnLoop);
    }

    return rawFetch(request);
  };
};

// We currently see issues with some requests on Deno and the current thinking is
// something in the H2 client is broken and the client is entering a weird state
// and either cannot get or lose a connection from the pool. This means that sometimes
// a fetch doesn't reach us at all, it can't establish connection.
// Our working theory is to temporarily switch to HTTP/1 for passthrough requests.
export const patchFetchToForceHTTP11 = (
  rawFetch: typeof globalThis.fetch,
) => {
  return (input: URL | Request | string, init?: RequestInit) => {
    const client = Deno.createHttpClient({ http1: true, http2: false });

    return rawFetch(input, { ...init, client });
  };
};
