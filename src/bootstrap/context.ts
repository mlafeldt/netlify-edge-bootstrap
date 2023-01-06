import type { Account } from "./account.ts";
import type { Cookies } from "./cookie_store.ts";
import type { FunctionChain } from "./function_chain.ts";
import type { Geo } from "./geo.ts";
import type { Site } from "./site.ts";

interface Context {
  cookies: Cookies;
  geo: Geo;
  ip: string;

  /**
   * @deprecated Use [`Response.json`](https://fetch.spec.whatwg.org/#ref-for-dom-response-json①) instead.
   */
  json: FunctionChain["json"];

  /**
   * @deprecated Use `console.log` instead.
   */
  log: ReturnType<FunctionChain["getLogFunction"]>;

  next(options?: NextOptions): Promise<Response>;
  /**
   * @param request `Request` to be passed down the request chain. Defaults to the original `request` object passed into the Edge Function.
   */
  next(request: Request, options?: NextOptions): Promise<Response>;

  requestId: string;
  rewrite: FunctionChain["rewrite"];
  site: Site;
  account: Account;
}

interface NextOptions {
  sendConditionalRequest?: boolean;
}

export type { Context, NextOptions };
