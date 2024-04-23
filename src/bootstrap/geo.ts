import * as base64 from "https://deno.land/std@0.170.0/encoding/base64.ts";
import type { Geo } from "./context.ts";

export function parseGeoHeader(geoHeader: string | null) {
  if (geoHeader === null) {
    return {};
  }

  try {
    const decoded = new TextDecoder().decode(base64.decode(geoHeader));

    const geoData: Geo = JSON.parse(decoded);

    return geoData;
  } catch {
    return {};
  }
}
