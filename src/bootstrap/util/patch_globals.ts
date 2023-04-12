import { patchDenoFS } from "../deno-fs.ts";
import { patchLogger } from "../log/instrumented_log.ts";
import { Metadata } from "../stage_2.ts";
import { patchResponseRedirect } from "../util/redirect.ts";

export const patchGlobals = (metadata?: Metadata) => {
  // https://developer.mozilla.org/en-US/docs/Web/API/console#instance_methods
  globalThis.console.log = patchLogger(globalThis.console.log, metadata);
  globalThis.console.error = patchLogger(globalThis.console.error, metadata);
  globalThis.console.debug = patchLogger(globalThis.console.debug, metadata);
  globalThis.console.warn = patchLogger(globalThis.console.warn, metadata);
  globalThis.console.info = patchLogger(globalThis.console.info, metadata);

  // https://deno.com/deploy/docs/runtime-fs
  globalThis.Deno.cwd = patchDenoFS(globalThis.Deno.cwd);
  globalThis.Deno.readDir = patchDenoFS(globalThis.Deno.readDir);
  globalThis.Deno.readFile = patchDenoFS(globalThis.Deno.readFile);
  globalThis.Deno.readTextFile = patchDenoFS(globalThis.Deno.readTextFile);
  globalThis.Deno.open = patchDenoFS(globalThis.Deno.open);
  globalThis.Deno.stat = patchDenoFS(globalThis.Deno.stat);
  globalThis.Deno.lstat = patchDenoFS(globalThis.Deno.lstat);
  globalThis.Deno.realPath = patchDenoFS(globalThis.Deno.realPath);
  globalThis.Deno.readLink = patchDenoFS(globalThis.Deno.readLink);

  Response.redirect = patchResponseRedirect(Response.redirect, metadata);
};
