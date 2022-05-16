import { writeStage1 } from "https://edge-bootstrap.netlify.app/bundler/stage1.ts";
import { writeStage2 } from "https://edge-bootstrap.netlify.app/bundler/stage2.ts";
import { resolve } from "https://deno.land/std@0.127.0/path/mod.ts";

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
