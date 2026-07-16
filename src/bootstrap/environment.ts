import { FeatureFlag } from "./feature_flags.ts";
import {
  getAIGateway,
  getFeatureFlags,
  getLogger,
  getNetlifyDBURL,
  getPurgeAPIToken,
} from "./request.ts";
import { EdgeRequest, getSite } from "./request.ts";
import { GetEnvFromEdgeFuncEnvHeader } from "./get_env_from_edge_func_env_header.ts";
import { env } from "../runtime/env.ts";

let hasPopulatedEnvironment = false;
let hasPopulatedEarlyAIEnvironment = false;

const NETLIFY_AI_GATEWAY_KEY_VAR = "NETLIFY_AI_GATEWAY_KEY";
const NETLIFY_AI_GATEWAY_BASE_URL_VAR = "NETLIFY_AI_GATEWAY_URL";
const NETLIFY_AI_GATEWAY_DEFAULT_PATH = "/.netlify/ai/";
const NETLIFY_ENVIRONMENT = "NETLIFY_ENVIRONMENT";
const NETLIFY_NIMBLE_ENV_STATUS = "NETLIFY_NIMBLE_ENV_STATUS";
const NETLIFY_NIMBLE_ROM_ENV_PREFIX = "NETLIFY_NIMBLE_ROM_ENV_";

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

// Capture initial environment to detect user-set variables
// Captured lazily on first use after module load or reset
let initialEnv: Record<string, string> | undefined;

/**
 * Injects AI Gateway base URL at isolate startup if SDK client intitialized
 * in top-level scope.
 */
const injectEarlyAIEnvironment = (
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

    // Capture initial environment on first use to detect user-set variables
    if (!initialEnv) {
      initialEnv = Deno.env.toObject();
    }

    // Set the Netlify AI Gateway base URL (static per isolate)
    Deno.env.set(NETLIFY_AI_GATEWAY_BASE_URL_VAR, aiGatewayBaseURL);

    const providersToProcess =
      Array.isArray(data.envVars) && data.envVars.length > 0
        ? data.envVars
        : [];

    // Only set BASE_URLs (keys expire and are set per-request)
    for (const { key, url } of providersToProcess) {
      if (initialEnv[key] || initialEnv[url]) {
        continue;
      }

      Deno.env.set(url, aiGatewayBaseURL);
    }
  } catch (error) {
    console.error(
      "An internal error occurred while setting up Netlify AI Gateway (early):",
      error,
    );
  }
};

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

    // Capture initial environment on first use to detect user-set variables
    if (!initialEnv) {
      initialEnv = env.toObject();
    }

    env.set(NETLIFY_AI_GATEWAY_BASE_URL_VAR, aiGatewayBaseURL);
    env.set(NETLIFY_AI_GATEWAY_KEY_VAR, data.token);
    const providersToProcess =
      Array.isArray(data.envVars) && data.envVars.length > 0
        ? data.envVars
        : [];

    for (const { key, url } of providersToProcess) {
      if (initialEnv[key] || initialEnv[url]) {
        continue;
      }

      env.set(key, data.token);
      env.set(url, aiGatewayBaseURL);
    }
  } catch (error) {
    console.error(
      "An internal error occurred while setting up Netlify AI Gateway:",
      error,
    );
  }
};

// Read this before we read any user-defined variables.
const environment = env.get(NETLIFY_ENVIRONMENT);
env.delete(NETLIFY_ENVIRONMENT);

const nimbleRomEnvStatus = env.get(NETLIFY_NIMBLE_ENV_STATUS);
env.delete(NETLIFY_NIMBLE_ENV_STATUS);

const nimbleRomEnvLoaded = nimbleRomEnvStatus === "ok_loaded" ||
  nimbleRomEnvStatus === "ok_no_env_vars";

const nimbleRomEnvError = env.get("NETLIFY_NIMBLE_ENV_ERROR");
env.delete("NETLIFY_NIMBLE_ENV_ERROR");

const romEnvVars = nimbleRomEnvLoaded ? readRomEnvVars() : undefined;

function readRomEnvVars(): Record<string, string> {
  const romVars: Record<string, string> = {};

  for (const [key, value] of Object.entries(env.toObject())) {
    if (!key.startsWith(NETLIFY_NIMBLE_ROM_ENV_PREFIX)) {
      continue;
    }

    // Remove the marker entry and recover the original env var name.
    env.delete(key);
    romVars[key.slice(NETLIFY_NIMBLE_ROM_ENV_PREFIX.length)] = value;
  }

  return romVars;
}

export const isNimbleRomEnvLoaded = () => nimbleRomEnvLoaded;

export const getEnvironment = () => {
  if (env.get("DENO_DEPLOYMENT_ID") || environment === "production") {
    return "production";
  }

  return "local";
};

export const injectEnvironmentVariablesFromHeader = (req: EdgeRequest) => {
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
    getLogger(req).debug("Environment variables header is not a valid object");
    return;
  }

  compareHeaderEnvVarsToROM(req, envVars);

  for (const [key, value] of Object.entries(envVars)) {
    if (typeof value === "string") {
      env.set(key, value);
    } else {
      getLogger(req)
        .withFields({ key, value_type: typeof value })
        .debug("Environment variable value is not a string, skipping");
    }
  }
};

// diffHeaderEnvVarsAgainstROM compares the Stargate-supplied env var header
// against the env vars the launcher decrypted from the ROM file, reporting
// drift in both directions. Pure — returns key names only (never values, since
// these are user secrets) so the caller can log the result safely.
export const diffHeaderEnvVarsAgainstROM = (
  headerVars: Record<string, string>,
  romVars: Record<string, string>,
): {
  // Keys the header supplied that the ROM file lacks.
  missingInROM: string[];
  // Keys the ROM file holds that the header did not supply. Once we cut over,
  // these would newly appear (or, from the header's perspective, were dropped).
  missingInHeader: string[];
  // Keys present in both sources but with differing values.
  valueMismatch: string[];
} => {
  const headerKeys = new Set(Object.keys(headerVars));
  const romKeys = new Set(Object.keys(romVars));

  const missingInROM = Array.from(headerKeys.difference(romKeys));
  const missingInHeader = Array.from(romKeys.difference(headerKeys));

  const valueMismatch: string[] = [];
  for (const key of headerKeys.intersection(romKeys)) {
    if (headerVars[key] !== romVars[key]) {
      valueMismatch.push(key);
    }
  }

  return { missingInROM, missingInHeader, valueMismatch };
};

// compareHeaderEnvVarsToROM diffs the header against the ROM env vars the
// launcher forwarded and emits the result as structured fields on the
// per-request logger, so we can graph drift over time before flipping the
// cutover. Logs key names only — never values, since these are user secrets.
const compareHeaderEnvVarsToROM = (
  req: EdgeRequest,
  headerVars: Record<string, string>,
) => {
  if (!romEnvVars) {
    if (
      nimbleRomEnvStatus?.startsWith("err") ||
      typeof nimbleRomEnvError !== "undefined"
    ) {
      // using bundle_version >= 1 but the launcher failed to load the ROM env file
      getLogger(req)
        .withFields({
          nimble_env_rom_status: nimbleRomEnvStatus,
          error: nimbleRomEnvError,
        })
        .error("Env vars not loaded from ROM file due to error");
    }

    return;
  }

  const { missingInROM, missingInHeader, valueMismatch } =
    diffHeaderEnvVarsAgainstROM(headerVars, romEnvVars);

  const driftCount = missingInROM.length + valueMismatch.length +
    missingInHeader.length;
  if (driftCount === 0) {
    getLogger(req)
      .withFields({
        nimble_env_drift_keys: 0,
        nimble_env_rom_status: nimbleRomEnvStatus,
      })
      .debug("No env var drift between header and ROM");

    return;
  }

  getLogger(req)
    .withFields({
      nimble_env_rom_status: nimbleRomEnvStatus,
      nimble_env_drift_keys: driftCount,
      nimble_env_missing_in_rom_keys: missingInROM,
      nimble_env_missing_in_header_keys: missingInHeader,
      nimble_env_value_mismatch_keys: valueMismatch,
    })
    .log("Env var drift between Stargate header and ROM file");
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
    env.set("NETLIFY_PURGE_API_TOKEN", purgeAPIToken);
  }

  const netlifyDBURL = getNetlifyDBURL(req);
  if (isNonEmptyString(netlifyDBURL)) {
    env.set("NETLIFY_DB_DRIVER", "serverless");
    env.set("NETLIFY_DB_URL", netlifyDBURL);
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
    env.set("SITE_ID", site.id);
  }

  if (site.name) {
    env.set("SITE_NAME", site.name);
  }

  if (site.url) {
    env.set("URL", site.url);
  }

  // If LogHTMLRewriter is enabled, set the env var for HTMLRewriter logging
  if (getFeatureFlags(req)[FeatureFlag.LogHTMLRewriter]) {
    env.set("NETLIFY_LOG_HTML_REWRITER", "true");
  }

  hasPopulatedEnvironment = true;
};

/**
 * Populates AI Gateway base URLs early, before Edge Functions are imported.
 * This is called on the first request to enable top-level AI client initialization.
 *
 * Only sets BASE_URL environment variables, not API keys (which expire and must be
 * refreshed per-request).
 */
export const populateEarlyAIEnvironment = (req: EdgeRequest) => {
  if (hasPopulatedEarlyAIEnvironment) {
    return;
  }

  const site = getSite(req);
  const aiGateway = getAIGateway(req);

  if (isNonEmptyString(aiGateway)) {
    injectEarlyAIEnvironment(aiGateway, site.url);
    hasPopulatedEarlyAIEnvironment = true;
  }
};

export const setHasPopulatedEnvironment = (val: boolean) => {
  hasPopulatedEnvironment = val;
  // Reset early AI environment flag when resetting environment state
  if (!val) {
    hasPopulatedEarlyAIEnvironment = false;
  }
};

// Test helper to reset initial environment cache (called when fully resetting test environment)
export const resetInitialEnv = () => {
  initialEnv = undefined;
};
