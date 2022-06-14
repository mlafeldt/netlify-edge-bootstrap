import { load } from "https://deno.land/x/eszip@v0.18.0/loader.ts";
import { LoadResponse } from "https://deno.land/x/eszip@v0.18.0/mod.ts";
import * as path from "https://deno.land/std@0.127.0/path/mod.ts";

const inlineModule = (
  specifier: string,
  content: string,
): LoadResponse => {
  return {
    content,
    headers: {
      "content-type": "application/typescript",
    },
    kind: "module",
    specifier,
  };
};

const loadFromVirtualRoot = async (
  specifier: string,
  virtualRoot: string,
  basePath: string,
) => {
  const basePathURL = path.toFileUrl(basePath).toString();
  const filePath = specifier.replace(virtualRoot.slice(0, -1), basePathURL);
  const file = await load(filePath);

  if (file === undefined) {
    throw new Error(`Could not find file: ${filePath}`);
  }

  return { ...file, specifier };
};

export { inlineModule, loadFromVirtualRoot };