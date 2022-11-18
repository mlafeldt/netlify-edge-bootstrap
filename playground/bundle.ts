#!/usr/bin/env -S deno run --allow-read=. --allow-write=. --allow-net=deno.land --no-check

// Netlify serializes all JS/TS code into two eszip files (stage 1 + 2) and
// deploys the result via Deno Deploy Subhosting, which (unlike Deno) can load
// multi-layered eszip files.
// You can use https://deno.land/x/eszip/eszip.ts to inspect eszip files.

import { writeStage1 } from "https://edge.netlify.com/bundler/stage1.ts";
import { writeStage2 } from "https://raw.githubusercontent.com/netlify/edge-bundler/main/deno/lib/stage2.ts";
import { resolve } from "https://deno.land/std@0.158.0/path/mod.ts";

const outDir = Deno.args[0];

await Deno.mkdir(outDir, { recursive: true });

await writeStage1(Deno.cwd(), resolve(outDir, "stage1.eszip"));

await writeStage2({
  basePath: Deno.cwd(),
  functions: [
    { name: "hello", path: "./playground/netlify/edge-functions/hello.ts" },
    { name: "skip", path: "./playground/netlify/edge-functions/skip.ts" },
    { name: "up", path: "./playground/netlify/edge-functions/up.ts" },
  ],
  destPath: resolve(outDir, "stage2.eszip"),
});
