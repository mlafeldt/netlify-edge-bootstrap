import { Status } from "https://deno.land/std@0.170.0/http/http_status.ts";

import { CookieStore } from "./cookie_store.ts";
import {
  getDiff as getHeadersDiff,
  InternalHeaders,
  serialize as serializeHeaders,
} from "./headers.ts";
import { EdgeRequest, getBypassSettings, hasFeatureFlag } from "./request.ts";

enum BypassDirective {
  Passthrough = "passthrough",
  Rewrite = "rewrite",
}

// Parses the bypass negotiation header. It holds a comma-separated list of
// directives for which a bypass is supported by the edge node.
const parseHeader = (req: EdgeRequest) => {
  const value = getBypassSettings(req);

  if (!value) {
    return [];
  }

  // Legacy value for backwards-compatibility.
  if (value === "1") {
    return [BypassDirective.Passthrough];
  }

  return value.split(",").map((directive) => directive.trim());
};

export const supportsPassthroughBypass = (req: EdgeRequest) =>
  parseHeader(req).includes(BypassDirective.Passthrough);

export const supportsRewriteBypass = (req: EdgeRequest) =>
  parseHeader(req).includes(BypassDirective.Rewrite);

interface BypassResponseOptions {
  cookies: CookieStore;
  currentRequest: EdgeRequest;
  initialRequestHeaders: Headers;
  initialRequestURL: URL;
}

interface BypassResponseBody {
  request_headers?: Record<string, string>;
  response_headers?: Record<string, string[]>;
  rewrite_url?: string;
}

export class BypassResponse extends Response {
  rewriteURL?: string;

  constructor(
    { cookies, currentRequest, initialRequestHeaders, initialRequestURL }:
      BypassResponseOptions,
  ) {
    const body: BypassResponseBody = {};

    if (currentRequest.url !== initialRequestURL.toString()) {
      body.rewrite_url = currentRequest.url;
    }

    const requestHeaders = getHeadersDiff(
      initialRequestHeaders,
      currentRequest.headers,
    );

    if (Object.keys(requestHeaders).length !== 0) {
      body.request_headers = requestHeaders;
    }

    const responseHeaders = serializeHeaders(cookies.apply(new Headers()));

    if (
      hasFeatureFlag(
        currentRequest,
        "edge_functions_bootstrap_bypass_response_headers",
      ) && Object.keys(responseHeaders).length !== 0
    ) {
      body.response_headers = responseHeaders;
    }

    super(JSON.stringify(body), {
      headers: {
        [InternalHeaders.EdgeFunctionBypass]: "1",
      },
      status: Status.OK,
    });

    this.rewriteURL = body.rewrite_url;
  }
}
