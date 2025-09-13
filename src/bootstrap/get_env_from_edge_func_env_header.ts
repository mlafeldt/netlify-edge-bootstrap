import {
  parseDictionary,
} from "../vendor/cdn.jsdelivr.net/npm/structured-headers@2.0.2/dist/index.js";

import {
  type BareItem,
  type Dictionary,
} from "../vendor/cdn.jsdelivr.net/npm/structured-headers@2.0.2/dist/types.d.ts";

import { InternalHeaders } from "./headers.ts";

/**
 * Extracts the environment variables from the InternalHeaders.NFEdgeFuncEnv header.
 * @param headers Headers object possibly containing InternalHeaders.NFEdgeFuncEnv entry
 * @returns A map of environment variable names to their values
 */
export function GetEnvFromEdgeFuncEnvHeader(
  headers: Headers,
): Record<string, string> {
  const header = headers.get(InternalHeaders.NFEdgeFuncEnv) ?? "";

  const out: Record<string, string> = {};
  const trimmed = header.trim();
  if (!trimmed) {
    return out;
  }

  // Parse the SF dictionary
  const dict: Dictionary = parseDictionary(trimmed);

  for (const [, value] of dict) {
    // Only expecting Items, not InnerLists
    if (Array.isArray(value[0])) {
      throw new Error("unexpected inner list");
    }

    const bare: BareItem = value[0];
    const params = value[1];

    // Recover original name from ;n="orig"
    const orig = params.get("n");
    if (!orig) {
      throw new Error("missing original name param");
    }
    if (typeof orig !== "string") {
      throw new Error("original name param is not a string");
    }

    if (typeof bare === "string") {
      out[orig] = bare;
    } else if (bare instanceof ArrayBuffer) {
      // Decode bytes back to string
      out[orig] = new TextDecoder().decode(new Uint8Array(bare));
    } else {
      // Fallback for remaining types number | boolean | Token | Date | DisplayString
      out[orig] = String(bare);
    }
  }

  return out;
}
