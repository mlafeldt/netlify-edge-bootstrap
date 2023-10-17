import { serve } from "./server.ts";

import * as stage2 from "netlify:bootstrap-stage2";

// Since the stage 1 file is the entry poiny of the isolate, it needs to start
// the server. However, the entry file of an ESZIP bundle can't use relative
// imports, so we code-gen an entry file in `src/bundler/stage1.ts` that then
// imports this file and calls `boot`.
export const boot = () => serve(stage2.functions);
