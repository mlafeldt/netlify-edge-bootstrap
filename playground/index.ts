#!/usr/bin/env -S deno run -L debug --allow-read=. --allow-env=DENO_DEPLOYMENT_ID --allow-net --import-map=./import_map.json --no-remote

import { boot } from "https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts";
import { EdgeFunction } from "netlify:edge";

// Netlify's edge bundler will generate the following code dynamically
// https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L106
//
// Note that file-based routing happens outside of the bootstrap code.
// See how the Netlify CLI does it for local dev:
// https://github.com/netlify/cli/blob/v10.3.0/src/lib/edge-functions/proxy.js#L92

const { default: helloFunc } = await import("./netlify/edge-functions/hello.ts");
const { default: skipFunc } = await import("./netlify/edge-functions/skip.ts");
const { default: upFunc } = await import("./netlify/edge-functions/up.ts");

const functions: Record<string, EdgeFunction> = {
  "hello": helloFunc,
  "skip": skipFunc,
  "up": upFunc,
};

boot(functions);
