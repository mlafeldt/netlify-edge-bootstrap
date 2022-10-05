import { build, LoadResponse } from "https://deno.land/x/eszip@v0.18.0/mod.ts";

import { STAGE1_SPECIFIER, STAGE2_SPECIFIER, virtualRoot } from "../consts.ts";
import { inlineModule, loadFromVirtualRoot, loadWithRetry } from "./common.ts";

const stage1Entry = `
import { boot } from "${virtualRoot}src/bootstrap/index-stage1.ts";

await boot()
`;

const stage1Loader =
  (basePath: string) =>
  async (specifier: string): Promise<LoadResponse | undefined> => {
    if (specifier === STAGE1_SPECIFIER) {
      return inlineModule(specifier, stage1Entry);
    }

    if (specifier === STAGE2_SPECIFIER) {
      return { kind: "external", specifier };
    }

    if (specifier.startsWith(virtualRoot)) {
      return loadFromVirtualRoot(specifier, virtualRoot, basePath);
    }

    return await loadWithRetry(specifier);
  };

const writeStage1 = async (basePath: string, destPath: string) => {
  const bytes = await build([STAGE1_SPECIFIER], stage1Loader(basePath));

  return await Deno.writeFile(destPath, bytes);
};

export { writeStage1 };
