import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";
import type { Account } from "./context.ts";

const decoder = new TextDecoder();

export function parseAccountHeader(accountHeader: string | null): Account {
  if (!accountHeader) {
    return {};
  }

  try {
    const accountData: Account = JSON.parse(
      decoder.decode(base64.decode(accountHeader)),
    );

    return accountData;
  } catch {
    return {};
  }
}
