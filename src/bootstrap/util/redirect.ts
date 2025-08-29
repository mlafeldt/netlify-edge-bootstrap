import { Status } from "../../vendor/deno.land/std@0.170.0/http/http_status.ts";

import { detachedLogger } from "../log/logger.ts";
import { getExecutionContextAndLogFailure } from "./execution_context.ts";

// https://github.com/denoland/deno/blob/7ba0d849aa8362091574232484563482f9b6bfe7/ext/fetch/23_response.js#L81-L88
const redirectStatus = new Set([
  Status.MovedPermanently,
  Status.Found,
  Status.SeeOther,
  Status.TemporaryRedirect,
  Status.PermanentRedirect,
]);

// Attempt to detect a response produced by `Response.redirect`. There's no
// unequivocal to assert it, so our best chance is to look for a response
// with the same characteristics. A false positive should be harmless,
// since we'll produce an identical response anyway.
export const isRedirect = (res: Response) => {
  const headers = [...res.headers.keys()];

  return res.body === null && redirectStatus.has(res.status) &&
    headers.length === 1 && headers[0] === "location";
};

// Patch `Response.redirect` so that it accepts a relative path.
export const patchResponseRedirect = (
  rawRedirect: typeof Response.redirect,
) => {
  return (...args: Parameters<typeof Response.redirect>) => {
    const [url, status] = args;

    // If the URL is a relative path, apply it to the URL of the incoming
    // request.
    if (typeof url === "string" && url.startsWith("/")) {
      try {
        const executionContext = getExecutionContextAndLogFailure(
          "response-redirect",
        );

        if (executionContext?.chain === undefined) {
          throw new Error("Could not find chain");
        }

        const { chain } = executionContext;
        const newURL = new URL(url, chain.request.url);

        return rawRedirect(newURL, status);
      } catch (error) {
        detachedLogger.withError(error).log(
          "An error occurred in the patched Response.redirect",
        );
      }
    }

    return rawRedirect(...args);
  };
};
