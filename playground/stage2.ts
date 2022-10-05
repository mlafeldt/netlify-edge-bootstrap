// Mimics Netlify's stage 2 loader without using eszip.
// See bundler/stage2.ts for the actual bundling code.
//
// Edge bundler also reimplements a loader for local dev:
// https://github.com/netlify/edge-bundler/blob/v1.1.0/src/formats/javascript.ts#L106
//
// Note that routing happens outside of the bootstrap code. See Netlify CLI:
// https://github.com/netlify/cli/blob/v10.3.0/src/lib/edge-functions/proxy.js#L92

import { EdgeFunction } from "netlify:edge";

const { default: helloFunc } = await import("./netlify/edge-functions/hello.ts");
const { default: skipFunc } = await import("./netlify/edge-functions/skip.ts");
const { default: upFunc } = await import("./netlify/edge-functions/up.ts");

export const functions: Record<string, EdgeFunction> = {
  "hello": helloFunc,
  "skip": skipFunc,
  "up": upFunc,
};

export const metadata = undefined;
