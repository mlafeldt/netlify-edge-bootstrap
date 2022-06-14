import type { Context, NextOptions } from "./context.ts";
import type { EdgeFunction } from "./edge_function.ts";
import { CookieStore } from "./cookie_store.ts";
import { getEnvironment } from "./environment.ts";
import { Geo, parseGeoHeader } from "./geo.ts";
import Headers from "./headers.ts";
import { EdgeRequest, OriginRequest } from "./request.ts";
import { OriginResponse } from "./response.ts";

interface FetchOriginOptions {
  url?: URL;
}

interface FunctionChainOptions {
  functions: RequestFunction[];
  request: EdgeRequest;
}

interface RequestFunction {
  name: string;
  function: EdgeFunction;
}

interface RunFunctionOptions {
  functionIndex: number;
  nextOptions?: NextOptions;
}

class FunctionChain {
  cookies: CookieStore;
  contextNextCalls: NextOptions[];
  functions: RequestFunction[];
  geo: Geo;
  ip: string | null;
  request: EdgeRequest;
  response: Response;

  constructor({ functions, request }: FunctionChainOptions) {
    this.contextNextCalls = [];
    this.functions = functions;
    this.geo = parseGeoHeader(request.headers.get(Headers.Geo));
    this.ip = request.headers.get(Headers.IP);
    this.request = request;
    this.response = new Response();
    this.cookies = new CookieStore(this.request);

    request.headers.delete(Headers.IP);
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
    const res = await fetch(originReq, { redirect: "manual" });
    const originRes = new OriginResponse(res, this.response);

    return originRes;
  }

  getContext(functionIndex: number) {
    const context: Context = {
      cookies: this.cookies.getPublicInterface(),
      geo: this.geo,
      ip: this.ip,
      json: this.json.bind(this),
      log: this.getLogFunction(functionIndex),
      next: (options: NextOptions = {}) => {
        this.contextNextCalls.push(options);

        return this.runFunction({
          functionIndex: functionIndex + 1,
          nextOptions: options,
        });
      },
      rewrite: this.rewrite.bind(this),
    };

    return context;
  }

  getLogFunction(functionIndex: number) {
    const { name } = this.functions[functionIndex];

    return (...data: unknown[]) => {
      const environment = getEnvironment();

      if (environment === "production") {
        console.log(JSON.stringify({ netlifyEdgeFunctionName: name }), ...data);

        return;
      }

      console.log(`[${name}]`, ...data);
    };
  }

  json(input: unknown, init?: ResponseInit) {
    const value = JSON.stringify(input);
    const headers = { ...init?.headers, "content-type": "application/json" };

    return new Response(value, { ...init, headers });
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

  async runFunction(
    { functionIndex, nextOptions }: RunFunctionOptions,
  ): Promise<Response> {
    const func = this.functions[functionIndex];

    if (func === undefined) {
      return this.fetchOrigin();
    }

    const context = this.getContext(functionIndex);

    try {
      const response = await func.function(this.request, context);

      if (response === undefined) {
        return this.runFunction({
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
