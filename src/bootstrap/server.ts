import { getEnvironment } from "./environment.ts";
import { handleRequest } from "./handler.ts";
import { patchFetchWithRewrites } from "./util/fetch.ts";
import { patchGlobals } from "./util/patch_globals.ts";
import type { EdgeFunction } from "./edge_function.ts";
import { parse } from "https://deno.land/std@0.170.0/flags/mod.ts";

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
  globalThis.fetch = patchFetchWithRewrites(globalThis.fetch, fetchRewrites);
}

patchGlobals();

export const serve = (
  functions: () => Promise<Record<string, EdgeFunction>>,
) => {
  const serveOptions: Deno.ServeTcpOptions = {
    // Adding a no-op listener to avoid the default one, which prints a message
    // we don't want.
    onListen() {},
  };

  const portRaw = parse(Deno.args).port || 8000;
  const port = parseInt(portRaw, 10);
  if (isNaN(port)) {
    throw new Error(
      `Invalid port supplied: ${portRaw}`,
    );
  }
  if (port < 0 || port > 65535) {
    throw new Error(`port must be between 0 and 65535, got ${port}`);
  }
  // Set the port for the server to listen on
  serveOptions.port = port;

  const server = Deno.serve(serveOptions, async (req: Request) => {
    try {
      return await handleRequest(req, await functions(), {
        fetchRewrites,
        rawLogger: consoleLog,
        requestTimeout: REQUEST_TIMEOUT,
      });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  });

  // Listen for shutdown signals to gracefully shut down the server
  Deno.addSignalListener("SIGINT", async () => {
    await server.shutdown();
  });

  // SIGTERM is not supported on Windows, only add listener on other platforms
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", async () => {
      await server.shutdown();
    });
  }

  return server.finished;
};
