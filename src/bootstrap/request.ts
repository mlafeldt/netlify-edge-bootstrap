import { getEnvironment } from "./environment.ts";
import NFHeaders, { conditionals as conditionalHeaders } from "./headers.ts";
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
  };

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    const requestInfo = input instanceof URL ? input.toString() : input;

    super(requestInfo, init);

    this[internals] = {
      forwardedHost: this.headers.get(NFHeaders.ForwardedHost),
      forwardedProtocol: this.headers.get(NFHeaders.ForwardedProtocol),
      passthrough: this.headers.get(NFHeaders.Passthrough),
      passthroughHost: this.headers.get(NFHeaders.PassthroughHost),
      requestID: this.headers.get(NFHeaders.RequestID),
      ip: this.headers.get(NFHeaders.IP),
      featureFlags: parseFeatureFlagsHeader(
        this.headers.get(NFHeaders.FeatureFlags),
      ),
    };

    [
      NFHeaders.ForwardedHost,
      NFHeaders.ForwardedProtocol,
      NFHeaders.Functions,
      NFHeaders.Passthrough,
      NFHeaders.PassthroughHost,
      NFHeaders.FeatureFlags,
    ].forEach((header) => {
      this.headers.delete(header);
    });
  }
}

export const getMode = (request: EdgeRequest) =>
  request[internals].passthrough ? Mode.BeforeCache : Mode.AfterCache;

export const getRequestID = (request: EdgeRequest) =>
  request[internals].requestID;

export const getPassthroughTiming = (request: EdgeRequest) =>
  request[internals].passthroughTiming;

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

class OriginRequest extends EdgeRequest {
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

    super(new Request(url.toString(), req));

    if (passthroughHeader !== null) {
      this.headers.set(NFHeaders.Passthrough, passthroughHeader);
    }

    if (requestIDHeader !== null) {
      this.headers.set(NFHeaders.RequestID, requestIDHeader);
    }

    if (stripConditionalHeaders) {
      conditionalHeaders.forEach((name) => {
        this.headers.delete(name);
      });
    }
  }
}

export { EdgeRequest, OriginRequest };
