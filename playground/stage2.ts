// Mimics Netlify's stage 2 loader without using eszip.
//
// Note that routing happens outside of the bootstrap code. See Netlify CLI:
// https://github.com/netlify/cli/blob/v12.2.3/src/lib/edge-functions/proxy.cjs#L112

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
