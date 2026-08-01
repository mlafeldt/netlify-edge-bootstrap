import { FeatureFlag, hasFlag } from "../feature_flags.ts";
import { InternalHeaders, StandardHeaders } from "../headers.ts";
import { internalsSymbol, PassthroughRequest } from "../request.ts";
import {
  getContextualLogger,
  getExecutionContextAndLogFailure,
} from "./execution_context.ts";

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
      getContextualLogger()
        .withFields({ args })
        .error("Could not get URL from arguments in fetch call");

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

    let result: Response | undefined;

    try {
      result = await rawFetch(...args);

      return result;
    } finally {
      call.end(result?.headers.get("cache-status"));
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

    if (cdnLoop) {
      request.headers.append(StandardHeaders.CDNLoop, cdnLoop);
    }

    return rawFetch(request);
  };
};

let http11Client: Deno.HttpClient;
function getHttp11Client() {
  if (!http11Client) {
    if (typeof Deno.createHttpClient !== "function") {
      throw new Error("Deno.createHttpClient is not available");
    }
    http11Client = Deno.createHttpClient({ http1: true, http2: false });
  }
  return http11Client;
}

// We currently see issues with some requests on Deno and the current thinking is
// something in the H2 client is broken and the client is entering a weird state
// and either cannot get or lose a connection from the pool. This means that sometimes
// a fetch doesn't reach us at all, it can't establish connection.
// Our working theory is to temporarily switch to HTTP/1 for passthrough requests.
export let isHTTP11ClientPatched = false;
export const patchFetchToForceHTTP11 = (rawFetch: typeof globalThis.fetch) => {
  if (isHTTP11ClientPatched) {
    return rawFetch;
  }
  isHTTP11ClientPatched = true;
  if (typeof Deno.createHttpClient !== "function") {
    return rawFetch;
  }
  http11Client = getHttp11Client();
  return (input: URL | Request | string, init?: RequestInit) => {
    return rawFetch(input, { ...init, client: http11Client });
  };
};

export const patchFetchToIncreaseMaxHeaderSizeLimit = (function () {
  let client: Deno.HttpClient;
  let isClientPatched = false;
  return (rawFetch: typeof globalThis.fetch) => {
    if (isClientPatched) {
      return rawFetch;
    }
    isClientPatched = true;
    if (typeof Deno.createHttpClient !== "function") {
      return rawFetch;
    }
    // The default max header list size is 16kb, which is too small for some requests.
    // We increase it to 256kb to avoid issues with requests that have large headers and match deno deploy.
    client = Deno.createHttpClient({ http2MaxHeaderListSize: 1024 * 256 });
    return (input: URL | Request | string, init?: RequestInit) => {
      return rawFetch(input, { ...init, client });
    };
  };
})();

// We currently see issues with some requests on Deno and the current thinking is
// something in the H2 client is broken and the client is entering a weird state
// and either cannot get or lose a connection from the pool. This means that sometimes
// a fetch doesn't reach us at all, it can't establish connection.
// To mitigate this, we patch the fetch to use its own connection pool
// so that it doesn't used the wider shared pool within Deno.
let client: Deno.HttpClient;
export let isClientPatched = false;
export const patchFetchToHaveItsOwnConnectionPoolPerIsolate = (
  rawFetch: typeof globalThis.fetch,
) => {
  if (isClientPatched) {
    return rawFetch;
  }
  isClientPatched = true;
  if (typeof Deno.createHttpClient !== "function") {
    return rawFetch;
  }
  client = Deno.createHttpClient({});
  return (input: URL | Request | string, init?: RequestInit) => {
    return rawFetch(input, { ...init, client });
  };
};

// The error surfaced when an HTTP/2 response exceeds the (currently
// non-configurable, 16kb) maximum header size has moved around between Deno
// versions. Up to Deno 2.8 it surfaced on the top-level error's `message`
// (e.g. "... http2 error: stream error detected: unspecific protocol error
// detected"). In Deno 2.9 the thrown error's `message` is just "fetch failed"
// and the protocol error is nested in `error.cause`. In every version seen so
// far the substring "stream error detected: unspecific protocol error
// detected" appears somewhere in the error or its cause chain, so we walk the
// chain and match on that.
//
// Note that the string does not originate in Deno itself: it comes from `h2`,
// the HTTP/2 implementation Deno's HTTP client is built on, which is why it has
// survived Deno's own error reshuffling.
// See https://github.com/hyperium/h2/blob/21211d065f8acd96827414020b5f53b63653f406/src/frame/reason.rs#L66
// This match holds as long as Deno keeps forwarding the `h2` error somewhere in
// the cause chain and does not swap out the underlying library.
export const isUnspecificProtocolError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);

    if (
      typeof current.message === "string" &&
      current.message.includes(
        "stream error detected: unspecific protocol error detected",
      )
    ) {
      return true;
    }

    current = current.cause;
  }

  return false;
};
