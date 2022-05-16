// Mimics Netlify's stage 1 loader without using eszip.
// See bundler/stage1.ts for the actual bundling code.

import { boot } from "https://edge-bootstrap.netlify.app/bootstrap/index-stage1.ts";

await boot();
