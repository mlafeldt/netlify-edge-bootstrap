import { Status } from "https://deno.land/std@0.136.0/http/http_status.ts";

import { Account, parseAccountHeader } from "./account.ts";
import type { Context, NextOptions } from "./context.ts";
import type { EdgeFunction } from "./edge_function.ts";
import { CookieStore } from "./cookie_store.ts";
import { Geo, parseGeoHeader } from "./geo.ts";
import { instrumentedLog, LogLocation } from "./log/log_location.ts";
import { parseSiteHeader, Site } from "./site.ts";
import { logger } from "./log/logger.ts";
import { InternalHeaders, serialize as serializeHeaders } from "./headers.ts";
import {
  EdgeRequest,
  getFeatureFlags,
  getMode,
  getRequestID,
  Mode,
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

const INTERNAL_HEADERS = [
  InternalHeaders.IP,
  InternalHeaders.SiteInfo,
  InternalHeaders.AccountInfo,
];

class FunctionChain {
  account: Account;
  cookies: CookieStore;
  contextNextCalls: NextOptions[];
  debug: boolean;
  functions: RequestFunction[];
  geo: Geo;
  initialHeaders: Headers;
  ip: string | null;
  mode: Mode;
  rawLogger?: Logger;
  request: EdgeRequest;
  requestID: string;
  response: Response;
  site: Site;

  constructor({ functions, rawLogger, request }: FunctionChainOptions) {
    this.contextNextCalls = [];
    this.debug = Boolean(request.headers.get(InternalHeaders.DebugLogging));
    this.functions = functions;
    this.geo = parseGeoHeader(request.headers.get(InternalHeaders.Geo));
    this.ip = request.headers.get(InternalHeaders.IP);
    this.mode = getMode(request);
    this.rawLogger = rawLogger;
    this.request = request;
    this.requestID = getRequestID(this.request) ?? "";
    this.response = new Response();
    this.cookies = new CookieStore(this.request);
    this.site = parseSiteHeader(request.headers.get(InternalHeaders.SiteInfo));
    this.account = parseAccountHeader(
      request.headers.get(InternalHeaders.AccountInfo),
    );

    this.stripInternalHeaders();

    this.initialHeaders = new Headers(this.request.headers);
  }

  private stripInternalHeaders() {
    for (const header of INTERNAL_HEADERS) {
      this.request.headers.delete(header);
    }
  }

  async fetchOrigin({ url }: FetchOriginOptions = {}) {
    const startTime = performance.now();

    // We strip the conditional headers if `context.next()` was called and at
    // least one of the calls was missing the `sendConditionalRequest` option.
    const stripConditionalHeaders = this.contextNextCalls.length > 0 &&
      this.contextNextCalls.some((options) => !options.sendConditionalRequest);
    const originReq = new OriginRequest({
      req: this.request,
      stripConditionalHeaders,
      url,
    });

    const res = await backoffRetry((retryCount) => {
      if (this.debug) {
        const message = retryCount === 0
          ? "Started edge function request to origin"
          : "Retrying edge function request to origin";

        logger
          .withFields({
            context_next_count: this.contextNextCalls.length,
            origin_url: url,
            retry_count: retryCount,
            strip_conditional_headers: stripConditionalHeaders,
          })
          .withRequestID(this.requestID)
          .log(message);
      }

      return fetch(originReq, { redirect: "manual" });
    });
    const originRes = new OriginResponse(res, this.response);

    // The edge node will send a header with how much time was spent in going to
    // origin. We attach it to the request so that we can attach it to the final response
    // later.
    const passthroughTiming = originRes.headers.get(
      InternalHeaders.PassthroughTiming,
    );
    if (passthroughTiming) {
      setPassthroughTiming(this.request, passthroughTiming);
    }

    const endTime = performance.now();

    if (this.debug) {
      logger
        .withFields({
          origin_duration: endTime - startTime,
          origin_status: res.status,
          origin_url: url,
        })
        .withRequestID(this.requestID)
        .log(
          "Finished edge function request to origin",
        );
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
        if (this.mode === Mode.AfterCache) {
          throw new Error(
            "Edge functions running after the cache cannot use `context.next()`. For more information, visit https://ntl.fyi/edge-after-cache",
          );
        }

        this.contextNextCalls.push(options);

        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions: options,
        });
      },
      requestId: this.requestID,
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
        this.requestID,
      );
    };
  }

  hasMutatedHeaders() {
    const headersA = serializeHeaders(this.initialHeaders);
    const headersB = serializeHeaders(this.request.headers);

    return headersA !== headersB;
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

    if (this.mode === Mode.AfterCache) {
      throw new Error(
        "Edge functions running after the cache cannot use `context.rewrite()`. For more information, visit https://ntl.fyi/edge-after-cache",
      );
    }

    if (newUrl.host !== requestUrl.host) {
      throw new Error(
        "Edge functions can only rewrite requests to the same host. For more information, visit https://ntl.fyi/edge-rewrite-external",
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

    // We got to the end of the chain and the last function has early-returned.
    if (func === undefined) {
      // If we're running after the cache, there's not much we can do other
      // than returning a blank response.
      if (this.mode === Mode.AfterCache) {
        return new Response(null, {
          status: Status.NoContent,
        });
      }

      // Return a bypass flag to the edge node, if possible.
      if (canBypass && flags.edge_functions_bootstrap_early_return) {
        return new Response(null, {
          headers: {
            [InternalHeaders.EdgeFunctionBypass]: "1",
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
        LogLocation.serializeRequestID(this.requestID),
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
        // 3. The request headers haven't been mutated — if they have, we'd
        //    have to send the new headers as part of the bypass signal so
        //    that they're added in our edge node
        const canBypass = nextOptions === undefined &&
          this.request.body === null && !this.hasMutatedHeaders();

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
