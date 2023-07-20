import * as base64 from "https://deno.land/std@0.170.0/encoding/base64.ts";
import type { Account } from "./context.ts";

export function parseAccountHeader(accountHeader: string | null): Account {
  if (!accountHeader) {
    return {};
  }

  try {
    const accountData: Account = JSON.parse(
      new TextDecoder().decode(base64.decode(accountHeader)),
    );

    return accountData;
  } catch {
    return {};
  }
}
