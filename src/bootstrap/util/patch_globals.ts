import { patchLogger } from "../log/instrumented_log.ts";
import { patchRequest } from "../request.ts";
import { Metadata } from "../stage_2.ts";
import { patchResponseRedirect } from "../util/redirect.ts";

export const patchGlobals = (metadata?: Metadata) => {
  // https://developer.mozilla.org/en-US/docs/Web/API/console#instance_methods
  globalThis.console.log = patchLogger(globalThis.console.log, metadata);
  globalThis.console.error = patchLogger(globalThis.console.error, metadata);
  globalThis.console.debug = patchLogger(globalThis.console.debug, metadata);
  globalThis.console.warn = patchLogger(globalThis.console.warn, metadata);
  globalThis.console.info = patchLogger(globalThis.console.info, metadata);

  Response.redirect = patchResponseRedirect(Response.redirect, metadata);

  // @ts-expect-error `globalThis` does not have a type for `Request`.
  globalThis.Request = patchRequest(globalThis.Request, metadata);
};
