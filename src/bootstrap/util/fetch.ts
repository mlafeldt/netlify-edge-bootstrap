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

    if (requestID) {
      request.headers.set(InternalHeaders.RequestID, requestID);
    }

    if (cdnLoop) {
      request.headers.append(StandardHeaders.CDNLoop, cdnLoop);
    }

    return rawFetch(request);
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
