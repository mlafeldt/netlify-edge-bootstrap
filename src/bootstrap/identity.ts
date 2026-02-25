import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";

import { executionStore } from "./util/execution_context.ts";

declare global {
  var netlifyIdentityContext: Record<string, unknown> | null;
}

const decoder = new TextDecoder();

export function parseIdentityHeader(
  identityHeader: string | null,
): Record<string, unknown> | null {
  if (!identityHeader) {
    return null;
  }

  try {
    return JSON.parse(decoder.decode(base64.decode(identityHeader)));
  } catch {
    return null;
  }
}

// Expose identity context as a per-request getter
export function setupIdentityGlobal() {
  Object.defineProperty(globalThis, "netlifyIdentityContext", {
    get() {
      return executionStore.getStore()?.chain?.identityContext ?? null;
    },
    enumerable: false,
    configurable: true,
  });
}
