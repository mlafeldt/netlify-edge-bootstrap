import { parse } from "../vendor/deno.land/std@0.170.0/flags/mod.ts";

import { getEnvironment } from "./environment.ts";
import { handleRequest } from "./handler.ts";
import { patchFetchWithRewrites } from "./util/fetch.ts";
import { patchGlobals } from "./util/patch_globals.ts";
import { Functions } from "./stage_2.ts";

// The timeout imposed by the edge nodes. It's important to keep this in place
// as a fallback in case we're unable to patch `fetch` to add our own here.
// https://github.com/netlify/stargate/blob/b5bc0eeb79bbbad3a8a6f41c7c73f1bcbcb8a9c8/proxy/deno/edge.go#L77
const UPSTREAM_REQUEST_TIMEOUT = 37_000;

// The overall timeout should be at most the limit imposed by the edge nodes
// minus a buffer that gives us enough time to send back a response.
const REQUEST_TIMEOUT = UPSTREAM_REQUEST_TIMEOUT - 1_000;

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
      handleRequest(req, functions, {
        fetchRewrites,
        rawLogger: consoleLog,
        requestTimeout: REQUEST_TIMEOUT,
      }),
  );

  return server.finished;
};
