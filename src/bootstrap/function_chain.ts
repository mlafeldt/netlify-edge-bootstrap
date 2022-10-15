import { Status } from "https://deno.land/std@0.136.0/http/http_status.ts";

import { Account, parseAccountHeader } from "./account.ts";
import type { Context, NextOptions } from "./context.ts";
import type { EdgeFunction } from "./edge_function.ts";
import { CookieStore } from "./cookie_store.ts";
import { Geo, parseGeoHeader } from "./geo.ts";
import { instrumentedLog, LogLocation } from "./log/log_location.ts";
import { parseSiteHeader, Site } from "./site.ts";
import Headers from "./headers.ts";
import {
  EdgeRequest,
  getFeatureFlags,
  getRequestID,
  OriginRequest,
  setPassthroughTiming,
} from "./request.ts";
import { Logger } from "./log/log_location.ts";
import { backoffRetry } from "./retry.ts";
import { OriginResponse } from "./response.ts";
import { callWithNamedWrapper } from "./util/named_wrapper.ts";

interface FetchOriginOptions {
  url?: URL;
}

interface FunctionChainOptions {
  functions: RequestFunction[];
  rawLogger?: Logger;
  request: EdgeRequest;
}

interface RequestFunction {
  name: string;
  function: EdgeFunction;
}

interface RunFunctionOptions {
  canBypass?: boolean;
  functionIndex: number;
  nextOptions?: NextOptions;
}

const INTERNAL_HEADERS = [Headers.IP, Headers.SiteInfo, Headers.AccountInfo];

class FunctionChain {
  cookies: CookieStore;
  contextNextCalls: NextOptions[];
  functions: RequestFunction[];
  geo: Geo;
  site: Site;
  account: Account;
  ip: string | null;
  rawLogger?: Logger;
  request: EdgeRequest;
  response: Response;

  constructor({ functions, rawLogger, request }: FunctionChainOptions) {
    this.contextNextCalls = [];
    this.functions = functions;
    this.geo = parseGeoHeader(request.headers.get(Headers.Geo));
    this.ip = request.headers.get(Headers.IP);
    this.rawLogger = rawLogger;
    this.request = request;
    this.response = new Response();
    this.cookies = new CookieStore(this.request);
    this.site = parseSiteHeader(request.headers.get(Headers.SiteInfo));
    this.account = parseAccountHeader(request.headers.get(Headers.AccountInfo));

    this.stripInternalHeaders();
  }

  private stripInternalHeaders() {
    for (const header of INTERNAL_HEADERS) {
      this.request.headers.delete(header);
    }
  }

  async fetchOrigin({ url }: FetchOriginOptions = {}) {
    // We strip the conditional headers if `context.next()` was called and at
    // least one of the calls was missing the `sendConditionalRequest` option.
    const stripConditionalHeaders = this.contextNextCalls.length > 0 &&
      this.contextNextCalls.some((options) => !options.sendConditionalRequest);
    const originReq = new OriginRequest({
      req: this.request,
      stripConditionalHeaders,
      url,
    });
    const res = await backoffRetry(() =>
      fetch(originReq, { redirect: "manual" })
    );
    const originRes = new OriginResponse(res, this.response);

    // The edge node will send a header with how much time was spent in going to
    // origin. We attach it to the request so that we can attach it to the final response
    // later.
    const passthroughTiming = originRes.headers.get(Headers.PassthroughTiming);
    if (passthroughTiming) {
      setPassthroughTiming(this.request, passthroughTiming);
    }

    return originRes;
  }

  getContext(functionIndex: number) {
    const context: Context = {
      cookies: this.cookies.getPublicInterface(),
      geo: this.geo,
      ip: this.ip ?? "",
      json: this.json.bind(this),
      log: this.getLogFunction(functionIndex),
      next: (options: NextOptions = {}) => {
        this.contextNextCalls.push(options);

        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions: options,
        });
      },
      requestId: getRequestID(this.request) ?? "",
      rewrite: this.rewrite.bind(this),
      site: this.site,
      account: this.account,
    };

    return context;
  }

  getLogFunction(functionIndex: number) {
    const { name } = this.functions[functionIndex];
    const logger = this.rawLogger ?? console.log;

    return (...data: unknown[]) => {
      return instrumentedLog(
        logger,
        data,
        name,
        getRequestID(this.request) ?? undefined,
      );
    };
  }

  json(input: unknown, init?: ResponseInit) {
    const value = JSON.stringify(input);
    const response = new Response(value, init);

    response.headers.set("content-type", "application/json");

    return response;
  }

  makeURL(urlPath: string) {
    if (urlPath.startsWith("/")) {
      const url = new URL(this.request.url);

      url.pathname = urlPath;

      return url;
    }

    return new URL(urlPath);
  }

  rewrite(url: string | URL) {
    const newUrl = url instanceof URL ? url : this.makeURL(url);
    const requestUrl = new URL(this.request.url);

    if (newUrl.host !== requestUrl.host) {
      throw new Error(
        "Edge Functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
      );
    }

    return this.fetchOrigin({ url: newUrl });
  }

  async run() {
    const response = await this.runFunction({ functionIndex: 0 });

    // Adding to the response any cookies that have been modified via the
    // `context.cookies` interface.
    this.cookies.apply(response);

    return response;
  }

  async runFunction({
    canBypass = false,
    functionIndex,
    nextOptions,
  }: RunFunctionOptions): Promise<Response> {
    const func = this.functions[functionIndex];
    const flags = getFeatureFlags(this.request);

    // If we got to the end of the function chain and the response hasn't been
    // terminated, we call origin.
    if (func === undefined) {
      if (canBypass && flags.edge_functions_bootstrap_early_return) {
        return new Response(null, {
          headers: {
            [Headers.EdgeFunctionBypass]: "1",
          },
          status: Status.NoContent,
        });
      }

      return this.fetchOrigin();
    }

    const context = this.getContext(functionIndex);

    try {
      // Rather than calling the function directly, we call it through a special
      // identity function. The name of this function has a marker that allows us
      // to decode the request ID from any `console.log` calls by inspecting the
      // stack trace.
      const response = await callWithNamedWrapper(
        () => func.function(this.request, context),
        LogLocation.serializeRequestID(getRequestID(this.request)),
      );

      if (response === undefined) {
        // If the function has early-returned, we can return a bypass header so
        // that our edge node can let the request follow its normal course. But
        // we can only do this when all of the conditions below are met:
        //
        // 1. The previous function hasn't called `context.next()` — if it has,
        //    we must return the full response as it may get transformed
        // 2. The request doesn't have a body — if it does, it's already been
        //    consumed and our edge node won't be able to process it further
        const canBypass = nextOptions === undefined &&
          this.request.body === null;

        return this.runFunction({
          canBypass,
          functionIndex: functionIndex + 1,
          nextOptions,
        });
      }

      return response;
    } catch (error) {
      context.log(error);
      throw error;
    }
  }
}

export { FunctionChain };
export type { Context };
