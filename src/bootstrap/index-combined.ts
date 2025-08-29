export { handleRequest } from "./handler.ts";
export { serve as boot } from "./server.ts";
export { patchGlobals } from "./util/patch_globals.ts";
export type { NetlifyGlobal as Netlify } from "./globals/types.ts";
