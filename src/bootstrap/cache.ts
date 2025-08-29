import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";

// @ts-types="../vendor/esm.sh/@netlify/cache@1.7.1/dist/bootstrap/main.d.ts"
import {
  NetlifyCacheStorage,
  Operation as CacheAPIOperation,
} from "../vendor/esm.sh/@netlify/cache@1.7.1/denonext/dist/bootstrap/main.mjs";

import { detachedLogger, rawConsole } from "./log/logger.ts";
import { Operations } from "./metrics.ts";
import { getCacheAPIToken, getCacheAPIURL } from "./request.ts";
import { UserError } from "./util/errors.ts";
import { getExecutionContextAndLogFailure } from "./util/execution_context.ts";

// Keep this in sync with the `@netlify/cache` import above.
export const CACHE_PACKAGE_VERSION = "1.7.1";

export { CacheAPIOperation };

export const getNetlifyCacheStorage = () =>
  new NetlifyCacheStorage({
    base64Encode: base64.encode,
    getContext: ({ operation: cacheAPIOperation }) => {
      const executionContext = getExecutionContextAndLogFailure(
        "cache-api",
      );
      const chain = executionContext?.chain;

      if (!chain?.request) {
        throw new UserError(
          "The Cache API must be used within the scope of the request handler. Refer to https://ntl.fyi/cache-api-scope for more information.",
        );
      }
      const operation = (cacheAPIOperation === CacheAPIOperation.Delete ||
          cacheAPIOperation === CacheAPIOperation.Write)
        ? Operations.CacheAPIWrite
        : Operations.CacheAPIRead;

      const allowance = chain.metrics.registerOperation(operation);

      // If we don't have allowance to perform this operation, we return an
      // empty context.
      if (allowance <= 0) {
        // To limit the log volume, we only log the first time that we go above
        // the allowance for a given invocation.
        if (allowance === 0) {
          rawConsole.log(
            `You've exceeded the number of allowed Cache API ${
              operation === Operations.CacheAPIWrite ? "writes" : "reads"
            } for a single invocation. Refer to https://ntl.fyi/cache-api-limits for more information.`,
          );
        }

        return null;
      }

      const { request } = chain;
      const host = new URL(request.url).hostname;
      const token = getCacheAPIToken(request);
      const url = getCacheAPIURL(request);

      if (!token || !url) {
        detachedLogger.withFields({
          has_token: Boolean(token),
          has_url: Boolean(url),
        }).log("missing Cache API metadata in request");

        return null;
      }

      const urlWithPath = new URL("/.netlify/cache", url);

      return {
        logger: (message) => chain.throttledLogger.log(message),
        host,
        url: urlWithPath.toString(),
        token,
      };
    },
    userAgent: `netlify-edge-functions@${CACHE_PACKAGE_VERSION}`,
  });
