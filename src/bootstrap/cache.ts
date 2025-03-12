import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";
import {
  NetlifyCacheStorage,
} from "../vendor/esm.sh/@netlify/cache@1.3.0/denonext/bootstrap.mjs";

import { getCacheAPIToken, getCacheAPIURL } from "./request.ts";
import { getExecutionContextAndLogFailure } from "./util/execution_context.ts";

// Keep this in sync with the `@netlify/cache` import above.
export const CACHE_PACKAGE_VERSION = "1.3.0";

const misconfiguredEnvironmentError = new Error(
  "The Cache API is not configured on this environment. Refer to https://ntl.fyi/ef-configure-cache for more information.",
);

export const getNetlifyCacheStorage = () =>
  new NetlifyCacheStorage({
    base64Encode: base64.encode,
    getContext: () => {
      const executionContext = getExecutionContextAndLogFailure(
        "cache-api",
      );
      const request = executionContext?.chain.request;

      if (!request) {
        throw misconfiguredEnvironmentError;
      }

      const host = new URL(request.url).hostname;
      const token = getCacheAPIToken(request);
      const url = getCacheAPIURL(request);

      if (!token || !url) {
        throw misconfiguredEnvironmentError;
      }

      const urlWithPath = new URL("/.netlify/cache", url);

      return {
        host,
        url: urlWithPath.toString(),
        token,
      };
    },
    userAgent: `netlify-edge-functions@${CACHE_PACKAGE_VERSION}`,
  });
