import { parse } from "../vendor/deno.land/std@0.170.0/flags/mod.ts";

import { getEnvironment } from "./environment.ts";
import { handleRequest } from "./handler.ts";
import { patchFetchWithRewrites } from "./util/fetch.ts";
import { patchGlobals } from "./util/patch_globals.ts";
import { Functions } from "./stage_2.ts";

const consoleLog = globalThis.console.log;
const fetchRewrites = new Map<string, string>();

// When running locally, we want to patch `fetch` so that it can rewrite URLs
// based on the entries of a map. This lets us rewrite origin requests to the
// right URL.
if (getEnvironment() === "local") {
  globalThis.fetch = patchFetchWithRewrites(
    globalThis.fetch,
    fetchRewrites,
  );
}

patchGlobals();

export const serve = (functions: Functions) => {
  const serveOptions: Deno.ServeTcpOptions = {
    // Adding a no-op listener to avoid the default one, which prints a message
    // we don't want.
    onListen() {},
  };
  const { port } = parse(Deno.args);

  if (port) {
    serveOptions.port = port;
  }

  const server = Deno.serve(
    serveOptions,
    (req: Request) =>
      handleRequest(req, functions, { fetchRewrites, rawLogger: consoleLog }),
  );

  return server.finished;
};
