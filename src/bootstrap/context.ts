import type { Cookies } from "./cookie.ts";

interface Geo {
  city?: string;
  country?: {
    code?: string;
    name?: string;
  };
  subdivision?: {
    code?: string;
    name?: string;
  };
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

interface Account {
  id?: string;
}

interface Site {
  id?: string;
  name?: string;
  url?: string;
}

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

  /**
   * @deprecated Use a `URL` object instead: https://ntl.fyi/edge-rewrite
   */
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

export type { Account, Context, Geo, NextOptions, Site };
