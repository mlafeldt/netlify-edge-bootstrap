import { getExecutionContextAndLogFailure } from "../util/execution_context.ts";

const env = {
  delete: Deno.env.delete,
  get: Deno.env.get,
  has: Deno.env.has,
  set: Deno.env.set,
  toObject: Deno.env.toObject,
};

// Whenever there's a change to this implementation, make sure to update https://github.com/netlify/edge-bundler/blob/19d142dcb17953e4c598626709662a2ddb6cf506/deno/config.ts#L2
export const Netlify = {
  get context() {
    const executionContext = getExecutionContextAndLogFailure("netlify-global");

    return executionContext?.context ?? null;
  },
  env,
};
