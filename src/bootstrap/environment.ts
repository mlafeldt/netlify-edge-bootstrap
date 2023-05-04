export const getEnvironment = () =>
  Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "local";
