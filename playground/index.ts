#!/usr/bin/env -S deno run -L debug --allow-read=. --allow-env=DENO_DEPLOYMENT_ID --allow-net --import-map ./vendor/import_map.json

import { boot } from "https://edge-bootstrap.netlify.app/bootstrap/index-combined.ts";
import { EdgeFunction } from "https://edge-bootstrap.netlify.app/bootstrap/edge_function.ts";

// Netlify's edge bundler will generate the following code dynamically
// https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L106
const { default: helloFunc } = await import("./netlify/edge-functions/hello.ts");
const { default: skipFunc } = await import("./netlify/edge-functions/skip.ts");
const { default: upFunc } = await import("./netlify/edge-functions/up.ts");

const functions: Record<string, EdgeFunction> = {
  "hello": helloFunc,
  "skip": skipFunc,
  "up": upFunc,
};

boot(functions);
