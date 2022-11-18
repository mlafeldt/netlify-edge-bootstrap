import { parse } from "https://deno.land/std@0.136.0/flags/mod.ts";
import {
  serve as denoServe,
  ServeInit,
} from "https://deno.land/std@0.136.0/http/server.ts";

import { handleRequest } from "./handler.ts";
import { patchLogger } from "./log/log_location.ts";
import { Functions, Metadata } from "./stage_2.ts";

export const serve = (functions: Functions, metadata?: Metadata) => {
  const consoleLog = globalThis.console.log;

  // based on https://developer.mozilla.org/en-US/docs/Web/API/console#instance_methods
  globalThis.console.log = patchLogger(globalThis.console.log, metadata);
  globalThis.console.error = patchLogger(globalThis.console.error, metadata);
  globalThis.console.debug = patchLogger(globalThis.console.debug, metadata);
  globalThis.console.warn = patchLogger(globalThis.console.warn, metadata);
  globalThis.console.info = patchLogger(globalThis.console.info, metadata);

  const serveOptions: ServeInit = {};
  const { port } = parse(Deno.args);

  if (port) {
    serveOptions.port = port;
  }

  return denoServe(
    (req: Request) => handleRequest(req, functions, { rawLogger: consoleLog }),
    serveOptions,
  );
};
