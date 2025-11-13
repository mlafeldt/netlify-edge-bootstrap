import { FeatureFlag, hasFlag } from "./feature_flags.ts";
import { getAIGateway, getLogger, getPurgeAPIToken } from "./request.ts";
import { EdgeRequest, getSite } from "./request.ts";
import { GetEnvFromEdgeFuncEnvHeader } from "./get_env_from_edge_func_env_header.ts";

let hasPopulatedEnvironment = false;

const NETLIFY_AI_GATEWAY_KEY_VAR = "NETLIFY_AI_GATEWAY_KEY";
const NETLIFY_AI_GATEWAY_BASE_URL_VAR = "NETLIFY_AI_GATEWAY_URL";
const NETLIFY_AI_GATEWAY_DEFAULT_PATH = "/.netlify/ai/";
const NETLIFY_ENVIRONMENT = "NETLIFY_ENVIRONMENT";
export const AI_PROVIDERS = [
  { key: "OPENAI_API_KEY", url: "OPENAI_BASE_URL" },
  { key: "ANTHROPIC_API_KEY", url: "ANTHROPIC_BASE_URL" },
  { key: "GEMINI_API_KEY", url: "GOOGLE_GEMINI_BASE_URL" },
];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length !== 0;

const getNetlifyAIGatewayBaseURL = (
  baseURL: string | undefined,
  siteURL: string,
): string =>
  isNonEmptyString(baseURL)
    ? baseURL
    : `${siteURL}${NETLIFY_AI_GATEWAY_DEFAULT_PATH}`;

interface AIProviderEnvVar {
  key: string;
  url: string;
}

interface AIGatewayData {
  token: string;
  url?: string | undefined;
  envVars?: AIProviderEnvVar[];
}

let initialEnv: Record<string, string>;

const injectAIEnvironment = (
  aiGateway: string,
  siteURL: string | undefined,
): void => {
  try {
    const rawData = atob(aiGateway);
    const data = JSON.parse(rawData) as AIGatewayData;

    const aiGatewayBaseURL = getNetlifyAIGatewayBaseURL(
      data.url,
      siteURL ?? "",
    );

    if (!initialEnv) {
      initialEnv = Deno.env.toObject();
    }

    Deno.env.set(NETLIFY_AI_GATEWAY_BASE_URL_VAR, aiGatewayBaseURL);
    Deno.env.set(NETLIFY_AI_GATEWAY_KEY_VAR, data.token);

    const providersToProcess =
      (Array.isArray(data.envVars) && data.envVars.length > 0)
        ? data.envVars
        : AI_PROVIDERS;

    for (const { key, url } of providersToProcess) {
      if (initialEnv[key] || initialEnv[url]) {
        continue;
      }

      Deno.env.set(key, data.token);
      Deno.env.set(url, aiGatewayBaseURL);
    }
  } catch (error) {
    console.error(
      "An internal error occurred while setting up Netlify AI Gateway:",
      error,
    );
  }
};

// Read this before we read any user-defined variables.
const environment = Deno.env.get(NETLIFY_ENVIRONMENT);
Deno.env.delete(NETLIFY_ENVIRONMENT);

export const getEnvironment = () => {
  if (Deno.env.get("DENO_DEPLOYMENT_ID") || (environment === "production")) {
    return "production";
  }

  return "local";
};

export const injectEnvironmentVariablesFromHeader = (req: EdgeRequest) => {
  if (!hasFlag(req, FeatureFlag.InjectEnvironmentVariablesFromHeader)) {
    return;
  }

  let envVars: Record<string, string> | undefined;
  try {
    envVars = GetEnvFromEdgeFuncEnvHeader(req.headers);
  } catch (error) {
    getLogger(req)
      .withError(error as Error)
      .debug("Failed to parse environment variables header");
    return;
  }

  if (typeof envVars !== "object" || envVars === null) {
    getLogger(req)
      .debug("Environment variables header is not a valid object");
    return;
  }

  for (const [key, value] of Object.entries(envVars)) {
    if (typeof value === "string") {
      Deno.env.set(key, value);
    } else {
      getLogger(req)
        .withFields({ key, value_type: typeof value })
        .debug(
          "Environment variable value is not a string, skipping",
        );
    }
  }
};

// Populate environment variables that require a check and/or update on each request.
const populateEphemeralEnvironment = (
  req: EdgeRequest,
  siteURL: string | undefined,
) => {
  // AI Gateway tokens expire aggressively, so we must refresh them on every invocation to ensure
  // they remain valid.
  const aiGateway = getAIGateway(req);
  if (isNonEmptyString(aiGateway)) {
    injectAIEnvironment(aiGateway, siteURL);
  }

  // Purge API tokens can change per request
  const purgeAPIToken = getPurgeAPIToken(req);
  if (purgeAPIToken) {
    Deno.env.set("NETLIFY_PURGE_API_TOKEN", purgeAPIToken);
  }
};

export const populateEnvironment = (req: EdgeRequest) => {
  const site = getSite(req);

  // Populate ephemeral environment variables first. Some env vars must be updated on every request
  // to ensure they remain valid, regardless of the guard below.
  populateEphemeralEnvironment(req, site.url);

  // There is some performance cost in setting environment variables on every
  // request. We know these static values will be the same for the lifecycle of
  // the isolate, so we can set them once.
  if (hasPopulatedEnvironment) {
    return;
  }

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

export const setHasPopulatedEnvironment = (val: boolean) => {
  hasPopulatedEnvironment = val;
  // Reset initialEnv cache when resetting environment state
  if (!val) {
    initialEnv = undefined as any;
  }
};
