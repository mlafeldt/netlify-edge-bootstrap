import { Account, parseAccountHeader } from "./account.ts";
import { getEnvironment } from "./environment.ts";
import { Geo, parseGeoHeader } from "./geo.ts";
import {
  conditionals as conditionalHeaders,
  InternalHeaders,
} from "./headers.ts";
import { FeatureFlags, parseFeatureFlagsHeader } from "./feature_flags.ts";
import { parseSiteHeader, Site } from "./site.ts";
import { OriginResponse } from "./response.ts";

export const internalsSymbol = Symbol("Netlify Internals");

export const enum CacheMode {
  Manual = "manual",
  Off = "off",
}

interface EdgeRequestInternals {
  account: Account;
  bypassSettings: string | null;
  cacheMode: string | null;
  featureFlags: FeatureFlags;
  forwardedHost: string | null;
  forwardedProtocol: string | null;
  geo: Geo;
  ip: string;
  passthrough: string | null;
  passthroughHost: string | null;
  passthroughHeaders?: Headers;
  requestID: string | null;
  site: Site;
}

export class EdgeRequest extends Request {
  [internalsSymbol]: EdgeRequestInternals;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const base = input instanceof URL ? new Request(input, init) : input;

    super(base);

    const internals = init instanceof EdgeRequest ? init[internalsSymbol] : {
      account: parseAccountHeader(
        this.headers.get(InternalHeaders.AccountInfo),
      ),
      bypassSettings: this.headers.get(InternalHeaders.EdgeFunctionBypass),
      cacheMode: this.headers.get(InternalHeaders.EdgeFunctionCache),
      featureFlags: parseFeatureFlagsHeader(
        this.headers.get(InternalHeaders.FeatureFlags),
      ),
      forwardedHost: this.headers.get(InternalHeaders.ForwardedHost),
      forwardedProtocol: this.headers.get(InternalHeaders.ForwardedProtocol),
      geo: parseGeoHeader(this.headers.get(InternalHeaders.Geo)),
      ip: this.headers.get(InternalHeaders.IP) ?? "",
      passthrough: this.headers.get(InternalHeaders.Passthrough),
      passthroughHost: this.headers.get(InternalHeaders.PassthroughHost),
      requestID: this.headers.get(InternalHeaders.RequestID),
      site: parseSiteHeader(this.headers.get(InternalHeaders.SiteInfo)),
    };

    this[internalsSymbol] = internals;

    [
      InternalHeaders.AccountInfo,
      InternalHeaders.ForwardedHost,
      InternalHeaders.ForwardedProtocol,
      InternalHeaders.Geo,
      InternalHeaders.IP,
      InternalHeaders.EdgeFunctions,
      InternalHeaders.LegacyEdgeFunctions,
      InternalHeaders.InvocationMetadata,
      InternalHeaders.Passthrough,
      InternalHeaders.LegacyPassthrough,
      InternalHeaders.PassthroughHost,
      InternalHeaders.FeatureFlags,
      InternalHeaders.EdgeFunctionBypass,
      InternalHeaders.SiteInfo,
    ].forEach((header) => {
      this.headers.delete(header);
    });
  }
}

export const getAccount = (request: EdgeRequest) =>
  request[internalsSymbol].account;

export const getCacheMode = (request: EdgeRequest) =>
  request[internalsSymbol].cacheMode === CacheMode.Manual
    ? CacheMode.Manual
    : CacheMode.Off;

export const getGeoLocation = (request: EdgeRequest) =>
  request[internalsSymbol].geo;

export const getIP = (request: EdgeRequest) => request[internalsSymbol].ip;

export const getRequestID = (request: EdgeRequest) =>
  request[internalsSymbol].requestID ?? "";

export const getBypassSettings = (request: EdgeRequest) =>
  request[internalsSymbol].bypassSettings;

export const getPassthroughHeaders = (request: EdgeRequest) =>
  request[internalsSymbol].passthroughHeaders ?? new Headers();

export const setPassthroughHeaders = (
  request: EdgeRequest,
  originResponse: OriginResponse,
) => {
  request[internalsSymbol].passthroughHeaders =
    originResponse[internalsSymbol].passthroughHeaders;
};

/**
 * Returns all feature flags for the request.
 * Only flags with prefix edge_functions_bootstrap_ are returned.
 * Beware: Only for Netlify-Internal use!
 */
export const getFeatureFlags = (request: EdgeRequest) =>
  request[internalsSymbol].featureFlags;

export const getSite = (request: EdgeRequest) => request[internalsSymbol].site;

interface PassthroughRequestOptions {
  req: EdgeRequest;
  stripConditionalHeaders?: boolean;
  url?: URL;
}

export class PassthroughRequest extends Request {
  constructor({
    req,
    stripConditionalHeaders = false,
    url = new URL(req.url),
  }: PassthroughRequestOptions) {
    const passthroughHeader = req[internalsSymbol].passthrough;
    const requestIDHeader = req[internalsSymbol].requestID;
    const environment = getEnvironment();

    // When running locally, we allow the client to specify the host and the
    // protocol used for origin requests.
    if (environment === "local") {
      url.host = req[internalsSymbol].forwardedHost ?? url.host;
      url.protocol = req[internalsSymbol].forwardedProtocol
        ? `${req[internalsSymbol].forwardedProtocol}:`
        : url.protocol;
    }

    // The edge node can pass this header to tell the isolate which host it
    // should use for the origin call.
    url.host = req[internalsSymbol].passthroughHost ?? url.host;

    let reqInit: Request = req;
    if (req.body && req.bodyUsed) {
      console.warn(
        "Request body already used. To use the body in further processing, pass the request to `context.next()`. See https://ntl.fyi/request-body-used for more information.",
      );
      reqInit = new Request(req, { body: "" });
    }

    super(new Request(url.toString(), reqInit));

    if (passthroughHeader !== null) {
      this.headers.set(InternalHeaders.Passthrough, passthroughHeader);
    }

    if (requestIDHeader !== null) {
      this.headers.set(InternalHeaders.RequestID, requestIDHeader);
    }

    if (stripConditionalHeaders) {
      conditionalHeaders.forEach((name) => {
        this.headers.delete(name);
      });
    }
  }
}
