import type { Account } from "./account.ts";
import type { Cookies } from "./cookie_store.ts";
import type { FunctionChain } from "./function_chain.ts";
import type { Geo } from "./geo.ts";
import type { Site } from "./site.ts";

interface Context {
  cookies: Cookies;
  geo: Geo;
  ip: string;
  json: FunctionChain["json"];
  log: ReturnType<FunctionChain["getLogFunction"]>;
  next: (options?: NextOptions) => Promise<Response>;
  requestId: string;
  rewrite: FunctionChain["rewrite"];
  site: Site;
  account: Account;
}

interface NextOptions {
  sendConditionalRequest?: boolean;
}

export type { Context, NextOptions };
