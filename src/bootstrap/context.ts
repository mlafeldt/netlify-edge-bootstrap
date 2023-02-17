import type { Account } from "./account.ts";
import type { Cookies } from "./cookie.ts";
import type { Geo } from "./geo.ts";
import type { Site } from "./site.ts";

interface Context {
  cookies: Cookies;
  geo: Geo;
  ip: string;

  /**
   * @deprecated Use [`Response.json`](https://fetch.spec.whatwg.org/#ref-for-dom-response-json①) instead.
   */
  json(input: unknown, init?: ResponseInit): Response;
  /**
   * @deprecated Use `console.log` instead.
   */
  log(...data: unknown[]): void;

  next(options?: NextOptions): Promise<Response>;
  /**
   * @param request `Request` to be passed down the request chain. Defaults to the original `request` object passed into the Edge Function.
   */
  next(request: Request, options?: NextOptions): Promise<Response>;

  requestId: string;
  rewrite(url: string | URL): Promise<Response>;
  site: Site;
  account: Account;
  server: ServerMetadata;
}

interface NextOptions {
  sendConditionalRequest?: boolean;
}

interface ServerMetadata {
  region: string;
}

export type { Context, NextOptions };
