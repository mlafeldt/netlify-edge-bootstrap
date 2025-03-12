import { parseAccountHeader } from "./account.ts";
import { BlobsMetadata, parseBlobsMetadata } from "./blobs.ts";
import { Account, Deploy, Geo, Site } from "./context.ts";
import { parseGeoHeader } from "./geo.ts";
import {
  conditionals as conditionalHeaders,
  InternalHeaders,
  StandardHeaders,
} from "./headers.ts";
import { FeatureFlags, parseFeatureFlagsHeader } from "./feature_flags.ts";
import {
  detachedLogger,
  LogLevel,
  type StructuredLogger,
} from "./log/logger.ts";
import { parseSiteHeader } from "./site.ts";
import { OriginResponse } from "./response.ts";

export const loggerSymbol = Symbol("Netlify Logger");
export const internalsSymbol = Symbol("Netlify Internals");

export const enum CacheMode {
  Manual = "manual",
  Off = "off",
}

interface EdgeRequestInternals {
  account: Account;
  blobs: BlobsMetadata;
  bypassSettings: string | null;
  cacheAPIURL: string | null;
  cacheAPIToken: string | null;
  cacheMode: string | null;
  cdnLoop: string | null;
  deploy: Deploy;
  featureFlags: FeatureFlags;
  forwardedHost: string | null;
  forwardedProtocol: string | null;
  geo: Geo;
  ip: string;
  passthrough: string | null;
  passthroughHost: string | null;
  passthroughProtocol: string | null;
  passthroughHeaders?: Headers;
  requestID: string | null;
  site: Site;
  purgeAPIToken: string | null;
}

const makeInternals = (headers: Headers): EdgeRequestInternals => {
  const site = parseSiteHeader(headers.get(InternalHeaders.SiteInfo));
  const deploy: Deploy = {
    context: headers.get(InternalHeaders.DeployContext) ?? undefined,
    id: headers.get(InternalHeaders.DeployID) ?? undefined,
    published: headers.get(InternalHeaders.DeployIsPublished) === "1",
  };

  return {
    account: parseAccountHeader(
      headers.get(InternalHeaders.AccountInfo),
    ),
    blobs: parseBlobsMetadata(headers.get(InternalHeaders.BlobsInfo)),
    bypassSettings: headers.get(InternalHeaders.EdgeFunctionBypass),
    cacheAPIURL: headers.get(InternalHeaders.CacheAPIURL),
    cacheAPIToken: headers.get(InternalHeaders.CacheAPIToken),
    cacheMode: headers.get(InternalHeaders.EdgeFunctionCache),
    cdnLoop: headers.get(StandardHeaders.CDNLoop),
    deploy,
    featureFlags: parseFeatureFlagsHeader(
      headers.get(InternalHeaders.FeatureFlags),
    ),
    forwardedHost: headers.get(InternalHeaders.ForwardedHost),
    forwardedProtocol: headers.get(InternalHeaders.ForwardedProtocol),
    geo: parseGeoHeader(headers.get(InternalHeaders.Geo)),
    ip: headers.get(InternalHeaders.IP) ?? "",
    passthrough: headers.get(InternalHeaders.Passthrough),
    passthroughHost: headers.get(InternalHeaders.PassthroughHost),
    passthroughProtocol: headers.get(InternalHeaders.PassthroughProtocol),
    requestID: headers.get(InternalHeaders.RequestID),
    purgeAPIToken: headers.get(InternalHeaders.PurgeAPIToken),
    site,
  };
};

export class EdgeRequest extends Request {
  [internalsSymbol]: EdgeRequestInternals;
  [loggerSymbol]: StructuredLogger;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const base = input instanceof URL ? new Request(input, init) : input;

    super(base);

    const internals = init instanceof EdgeRequest
      ? init[internalsSymbol]
      : makeInternals(this.headers);

    this[internalsSymbol] = internals;

    const requestID = this.headers.get(InternalHeaders.RequestID);
    const logLevel = this.headers.has(InternalHeaders.DebugLogging)
      ? LogLevel.Debug
      : LogLevel.Log;

    this[loggerSymbol] = detachedLogger.withRequestID(requestID).withLogLevel(
      logLevel,
    );

    [
      InternalHeaders.AccountInfo,
      InternalHeaders.CacheAPIToken,
      InternalHeaders.CacheAPIURL,
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
      InternalHeaders.PassthroughProtocol,
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

export const getBlobs = (request: EdgeRequest) =>
  request[internalsSymbol].blobs;

export const getCacheAPIURL = (request: EdgeRequest) =>
  request[internalsSymbol].cacheAPIURL;

export const getCacheAPIToken = (request: EdgeRequest) =>
  request[internalsSymbol].cacheAPIToken;

export const getCacheMode = (request: EdgeRequest) =>
  request[internalsSymbol].cacheMode === CacheMode.Manual
    ? CacheMode.Manual
    : CacheMode.Off;

export const getDeploy = (request: EdgeRequest) =>
  request[internalsSymbol].deploy;

export const getGeoLocation = (request: EdgeRequest) =>
  request[internalsSymbol].geo;

export const getIP = (request: EdgeRequest) => request[internalsSymbol].ip;

export const getLogger = (request: EdgeRequest) => request[loggerSymbol];

export const getRequestID = (request: EdgeRequest) =>
  request[internalsSymbol].requestID ?? "";

export const getBypassSettings = (request: EdgeRequest) =>
  request[internalsSymbol].bypassSettings;

export const getPassthroughHeaders = (request: EdgeRequest) =>
  request[internalsSymbol].passthroughHeaders ?? new Headers();

export const getPurgeAPIToken = (request: EdgeRequest) =>
  request[internalsSymbol].purgeAPIToken;

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

    // The edge node can pass these headers to tell the isolate which host it
    // should use for the origin call.
    url.host = req[internalsSymbol].passthroughHost ?? url.host;
    url.protocol = req[internalsSymbol].passthroughProtocol ?? url.protocol;

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
