import { EdgeRequest, getSite } from "./request.ts";

let hasPopulatedEnvironment = false;

export const getEnvironment = () =>
  Deno.env.get("DENO_DEPLOYMENT_ID") ? "production" : "local";

export const populateEnvironment = (req: EdgeRequest) => {
  // There is some performance cost in setting environment variables on every
  // request. We know these values will be the same for the lifecycle of the
  // isolate, so we can set them once.
  if (hasPopulatedEnvironment) {
    return;
  }

  const site = getSite(req);

  if (site.id) {
    Deno.env.set("SITE_ID", site.id);
  }

  if (site.name) {
    Deno.env.set("SITE_NAME", site.name);
  }

  if (site.url) {
    Deno.env.set("URL", site.url);
  }

  hasPopulatedEnvironment = true;
};
