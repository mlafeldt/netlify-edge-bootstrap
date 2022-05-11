import { parse } from "https://deno.land/std@0.136.0/flags/mod.ts";
import {
  serve as denoServe,
  ServeInit,
} from "https://deno.land/std@0.136.0/http/server.ts";

import { EdgeFunction } from "./edge_function.ts";
import { handleRequest } from "./handler.ts";

export const serve = (functions: Record<string, EdgeFunction>) => {
  const serveOptions: ServeInit = {};
  const { port } = parse(Deno.args);

  if (port) {
    serveOptions.port = port;
  }

  return denoServe(
    (req: Request) => handleRequest(req, functions),
    serveOptions,
  );
};
