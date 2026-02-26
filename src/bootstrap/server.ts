import { getEnvironment } from "./environment.ts";
import { InternalHeaders } from "./headers.ts";
import { handleRequest } from "./handler.ts";
import { patchFetchWithRewrites } from "./util/fetch.ts";
import { patchGlobals } from "./util/patch_globals.ts";
import { parse } from "../vendor/deno.land/std@0.170.0/flags/mod.ts";
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
  globalThis.fetch = patchFetchWithRewrites(globalThis.fetch, fetchRewrites);
}

patchGlobals();

export const serve = (
  functions: () => Promise<Functions>,
  onListen?: () => void,
) => {
  const serveOptions: Deno.ServeTcpOptions = {
    onListen() {
      if (typeof onListen === "function") {
        onListen();
      }
    },
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
      return await handleRequest(req, functions, {
        fetchRewrites,
        rawLogger: consoleLog,
        requestTimeout: REQUEST_TIMEOUT,
      });
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response("Internal Server Error", {
        status: 500,
        headers: {
          [InternalHeaders.PlatformError]: JSON.stringify({
            "code": "bootstrap_error",
            "message": "An unexpected error occurred",
          }),
        },
      });
    }
  });

  // Listen for shutdown signals and exit immediately
  Deno.addSignalListener("SIGINT", () => {
    Deno.exit(0);
  });

  // SIGTERM is not supported on Windows, only add listener on other platforms
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", () => {
      Deno.exit(0);
    });
  }

  return server.finished;
};
