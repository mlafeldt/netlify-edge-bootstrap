import { FeatureFlag, hasFlag } from "../feature_flags.ts";
import { InternalHeaders, StandardHeaders } from "../headers.ts";
import { detachedLogger, logger } from "../log/logger.ts";
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
    const url = safelyGetFetchURL(args[0]);

    if (url === undefined) {
      detachedLogger.withFields({ args }).error(
        "Could not get URL from arguments in fetch call",
      );

      return rawFetch(...args);
    }

    const { chain } = getExecutionContextAndLogFailure("track-subrequests");

    if (chain === undefined) {
      return rawFetch(...args);
    }

    // @ts-ignore-error Deno 2.0 flags this as a type error even though `signal`
    // is part of `RequestInit`. More context:
    // https://netlify.slack.com/archives/C0359548J07/p1732894713803429
    const { signal: userSignal } = args[1] ?? {};
    const { signal: chainSignal } = chain.executionController;
    const signal = AbortSignal.any(
      [userSignal, chainSignal].filter(Boolean) as AbortSignal[],
    );

    args[1] = { ...args[1], signal };

    const call = args[0] instanceof PassthroughRequest
      ? chain.metrics.startPassthrough()
      : chain.metrics.startFetch(
        url.host,
      );

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
    if (input instanceof PassthroughRequest) {
      return rawFetch(input, init);
    }

    const { chain } = getExecutionContextAndLogFailure("forward-headers");
    if (chain === undefined) {
      return rawFetch(input, init);
    }

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
