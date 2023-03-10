import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";
import {
  serve as denoServe,
  ServeInit,
} from "https://deno.land/std@0.170.0/http/server.ts";

import { handleRequest } from "./handler.ts";
import { patchGlobals } from "./util/patch_globals.ts";
import { Functions, Metadata } from "./stage_2.ts";

export const serve = (functions: Functions, metadata?: Metadata) => {
  const consoleLog = globalThis.console.log;

  patchGlobals(metadata);

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
