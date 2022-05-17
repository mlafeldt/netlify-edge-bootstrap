#!/usr/bin/env -S deno run --allow-read=. --allow-env=DENO_DEPLOYMENT_ID --allow-net=0.0.0.0 --import-map=./import_map.json --no-remote --no-check -L debug

// Mimics Netlify's stage 1 loader without using eszip.
// See bundler/stage1.ts for the actual bundling code.

import { boot } from "https://edge-bootstrap.netlify.app/bootstrap/index-stage1.ts";

await boot();
