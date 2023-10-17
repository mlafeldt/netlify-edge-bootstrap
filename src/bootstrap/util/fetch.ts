import { FeatureFlag, hasFlag } from "../feature_flags.ts";
import { EdgeRequest, PassthroughRequest } from "../request.ts";
import { FunctionChain } from "../function_chain.ts";
import { getExecutionContext } from "./execution_context.ts";

// Returns a patched version of `fetch` that hijacks requests for the same
// URL origin and runs any edge functions associated with the new path.
export const patchFetchToRunFunctions = (
  rawFetch: typeof globalThis.fetch,
) => {
  return (...args: Parameters<typeof globalThis.fetch>) => {
    // prevents infinite loop
    if (args[0] instanceof PassthroughRequest) {
      return rawFetch(...args);
    }

    try {
      const { chain } = getExecutionContext();

      if (chain === undefined) {
        throw new Error("Could not find chain");
      }

      if (!hasFlag(chain.request, FeatureFlag.RunFunctionsOnFetch)) {
        throw new Error("Feature flag not set");
      }

      const fetchRequest = new Request(args[0], args[1]);
      const fetchURL = new URL(fetchRequest.url);
      const requestURL = new URL(chain.request.url);

      // We only want to run additional edge functions for same-site calls.
      if (fetchURL.origin === requestURL.origin) {
        const functions = chain.router.match(fetchURL, fetchRequest.method);
        const newRequest = new EdgeRequest(fetchRequest, chain.request);
        const newChain = new FunctionChain({
          request: newRequest,
          functionNames: functions.map((route) => route.name),
          invokedFunctions: chain.invokedFunctions,
          rawLogger: console.log,
          router: chain.router,
        });

        return newChain.run({
          requireFinalResponse: true,
        });
      }
    } catch {
      // no-op
    }

    return rawFetch(...args);
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
