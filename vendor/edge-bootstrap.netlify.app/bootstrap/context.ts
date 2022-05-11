import type { Cookies } from "./cookie_store.ts";
import type { FunctionChain } from "./function_chain.ts";
import type { Geo } from "./geo.ts";

interface Context {
  cookies: Cookies;
  geo: Geo;
  json: FunctionChain["json"];
  log: ReturnType<FunctionChain["getLogFunction"]>;
  next: (options?: NextOptions) => Promise<Response>;
  rewrite: FunctionChain["rewrite"];
}

interface NextOptions {
  sendConditionalRequest?: boolean;
}

export type { Context, NextOptions };
