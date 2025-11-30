#!/usr/bin/env -S deno run --allow-read=. --allow-env --allow-net=0.0.0.0 --no-check -L debug

// Mimics Netlify's stage 1 loader without using eszip.
// See src/bundler/stage1.ts for the actual bundling code.

import { boot } from "https://edge.netlify.com/bootstrap/index-stage1.ts";

await boot();
