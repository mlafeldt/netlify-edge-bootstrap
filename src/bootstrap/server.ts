import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";
import {
  serve as denoServe,
  ServeInit,
} from "https://deno.land/std@0.170.0/http/server.ts";

import { handleRequest } from "./handler.ts";
import { patchLogger } from "./log/instrumented_log.ts";
import { patchResponseRedirect } from "./util/redirect.ts";
import { Functions, Metadata } from "./stage_2.ts";

export const serve = (functions: Functions, metadata?: Metadata) => {
  const consoleLog = globalThis.console.log;

  // based on https://developer.mozilla.org/en-US/docs/Web/API/console#instance_methods
  globalThis.console.log = patchLogger(globalThis.console.log, metadata);
  globalThis.console.error = patchLogger(globalThis.console.error, metadata);
  globalThis.console.debug = patchLogger(globalThis.console.debug, metadata);
  globalThis.console.warn = patchLogger(globalThis.console.warn, metadata);
  globalThis.console.info = patchLogger(globalThis.console.info, metadata);

  Response.redirect = patchResponseRedirect(Response.redirect, metadata);

  const serveOptions: ServeInit = {
    // Adding a no-op listener to avoid the default one, which prints a message
    // we don't want.
    onListen() {},
  };
  const { port } = parse(Deno.args);

  if (port) {
    serveOptions.port = port;
  }

  return denoServe(
    (req: Request) => handleRequest(req, functions, { rawLogger: consoleLog }),
    serveOptions,
  );
};
