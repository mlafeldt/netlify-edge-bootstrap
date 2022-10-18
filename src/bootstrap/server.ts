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
  globalThis.console.log = patchLogger(globalThis.console.log, metadata);

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
