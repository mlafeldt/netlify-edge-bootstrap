import { UnhandledFunctionError } from "./util/errors.ts";

const errorCallback = () => {
  throw new UnhandledFunctionError(
    "Reading or writing files with Edge Functions is not supported yet. " +
      "Visit https://ntl.fyi/edge-functions-filesystem to learn more and tell us about your use cases for file system access.",
  );
};

export function patchDenoFS<T>(_denoFSmethod: T): T {
  return errorCallback as T;
}
