import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";
import type { Site } from "./context.ts";

const decoder = new TextDecoder();

export function parseSiteHeader(siteHeader: string | null): Site {
  if (!siteHeader) {
    return {};
  }

  try {
    const siteData: Site = JSON.parse(
      decoder.decode(base64.decode(siteHeader)),
    );

    return siteData;
  } catch {
    return {};
  }
}
