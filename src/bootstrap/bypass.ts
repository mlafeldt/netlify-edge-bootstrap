import { Status } from "https://deno.land/std@0.170.0/http/http_status.ts";

import { CookieStore } from "./cookie_store.ts";
import {
  getDiff as getHeadersDiff,
  InternalHeaders,
  serialize as serializeHeaders,
  StandardHeaders,
} from "./headers.ts";
import { EdgeRequest, getBypassSettings } from "./request.ts";

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
    const headers = new Headers({ [InternalHeaders.EdgeFunctionBypass]: "1" });

    // If the request doesn't support the advanced bypass mechanism, return
    // an empty body.
    if (!supportsRewriteBypass(currentRequest)) {
      super(null, {
        headers,
        status: Status.NoContent,
      });

      return;
    }

    const payload: BypassResponseBody = {};

    if (currentRequest.url !== initialRequestURL.toString()) {
      payload.rewrite_url = currentRequest.url;
    }

    const requestHeaders = getHeadersDiff(
      initialRequestHeaders,
      currentRequest.headers,
    );

    if (Object.keys(requestHeaders).length !== 0) {
      payload.request_headers = requestHeaders;
    }

    const responseHeaders = serializeHeaders(cookies.apply(new Headers()));

    if (Object.keys(responseHeaders).length !== 0) {
      payload.response_headers = responseHeaders;
    }

    const [body, status] = Object.keys(payload).length === 0
      ? [null, Status.NoContent]
      : [JSON.stringify(payload), Status.OK];

    // This header stops Deno from automatically compressing the response body:
    // https://deno.land/manual@v1.25.4/runtime/http_server_apis#when-is-compression-skipped
    headers.set(StandardHeaders.CacheControl, "no-transform");

    super(body, {
      headers,
      status,
    });

    this.rewriteURL = payload.rewrite_url;
  }
}
