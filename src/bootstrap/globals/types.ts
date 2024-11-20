// The types in this file are kept isolated from the implementation so that an
// import of `@netlify/edge-functions` doesn't have any runtime dependencies.
import type { Context } from "../context.ts";

declare global {
  // Using `var` so that the declaration is hoisted in such a way that we can
  // reference it before it's initialized.
  // deno-lint-ignore no-var
  var Netlify: NetlifyGlobal;
}

interface Env {
  delete: (key: string) => void;
  get: (key: string) => string | undefined;
  has: (key: string) => boolean;
  set: (key: string, value: string) => void;
  toObject: () => { [index: string]: string };
}

export interface NetlifyGlobal {
  context: Context | null;
  env: Env;
}
