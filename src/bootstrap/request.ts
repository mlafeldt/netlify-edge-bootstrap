import { getEnvironment } from "./environment.ts";
import {
  conditionals as conditionalHeaders,
  InternalHeaders,
} from "./headers.ts";
import { FeatureFlags, parseFeatureFlagsHeader } from "./feature_flags.ts";

const internals = Symbol("Netlify Internals");

export const enum Mode {
  BeforeCache = "before-cache",
  AfterCache = "after-cache",
}

class EdgeRequest extends Request {
  [internals]: {
    forwardedHost: string | null;
    forwardedProtocol: string | null;
    requestID: string | null;
    passthrough: string | null;
    passthroughHost: string | null;
    ip: string | null;
    featureFlags: FeatureFlags;
    passthroughTiming?: string;
    acceptsBypass?: boolean;
  };

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const requestInfo = input instanceof URL ? input.toString() : input;

    super(requestInfo, init);

    this[internals] = {
      forwardedHost: this.headers.get(InternalHeaders.ForwardedHost),
      forwardedProtocol: this.headers.get(InternalHeaders.ForwardedProtocol),
      passthrough: this.headers.get(InternalHeaders.Passthrough),
      passthroughHost: this.headers.get(InternalHeaders.PassthroughHost),
      requestID: this.headers.get(InternalHeaders.RequestID),
      ip: this.headers.get(InternalHeaders.IP),
      featureFlags: parseFeatureFlagsHeader(
        this.headers.get(InternalHeaders.FeatureFlags),
      ),
      acceptsBypass: this.headers.has(InternalHeaders.EdgeFunctionBypass),
    };

    [
      InternalHeaders.ForwardedHost,
      InternalHeaders.ForwardedProtocol,
      InternalHeaders.Functions,
      InternalHeaders.Passthrough,
      InternalHeaders.PassthroughHost,
      InternalHeaders.FeatureFlags,
      InternalHeaders.EdgeFunctionBypass,
    ].forEach((header) => {
      this.headers.delete(header);
    });
  }
}

const clone = (edgeRequest: EdgeRequest, request?: Request) => {
  const newEdgeRequest = new EdgeRequest(request ?? edgeRequest);
  newEdgeRequest[internals] = edgeRequest[internals];
  return newEdgeRequest;
};

export const getMode = (request: EdgeRequest) =>
  request[internals].passthrough ? Mode.BeforeCache : Mode.AfterCache;

export const getRequestID = (request: EdgeRequest) =>
  request[internals].requestID;

export const getPassthroughTiming = (request: EdgeRequest) =>
  request[internals].passthroughTiming;

export const acceptsBypass = (request: EdgeRequest) =>
  request[internals].acceptsBypass;

export const setPassthroughTiming = (request: EdgeRequest, value: string) => {
  request[internals].passthroughTiming = value;
};

/**
 * Returns all feature flags for the request.
 * Only flags with prefix edge_functions_bootstrap_ are returned.
 * Beware: Only for Netlify-Internal use!
 */
export const getFeatureFlags = (request: EdgeRequest) =>
  request[internals].featureFlags;

interface OriginRequestOptions {
  req: EdgeRequest;
  stripConditionalHeaders?: boolean;
  url?: URL;
}

class OriginRequest extends Request {
  constructor({
    req,
    stripConditionalHeaders = false,
    url = new URL(req.url),
  }: OriginRequestOptions) {
    const passthroughHeader = req[internals].passthrough;
    const requestIDHeader = req[internals].requestID;
    const environment = getEnvironment();

    // When running locally, we allow the client to specify the host and the
    // protocol used for origin requests.
    if (environment === "local") {
      url.host = req[internals].forwardedHost ?? url.host;
      url.protocol = req[internals].forwardedProtocol
        ? `${req[internals].forwardedProtocol}:`
        : url.protocol;
    }

    // The edge node can pass this header to tell the isolate which host it
    // should use for the origin call.
    url.host = req[internals].passthroughHost ?? url.host;

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

export { clone, EdgeRequest, OriginRequest };
