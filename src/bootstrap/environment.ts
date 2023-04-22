export const env = {
  delete: Deno.env.delete,
  get: Deno.env.get,
  has: Deno.env.has,
  set: Deno.env.set,
  toObject: Deno.env.toObject,
};

export const getEnvironment = () =>
  Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "local";
