import * as base64 from "../vendor/deno.land/std@0.170.0/encoding/base64.ts";
import type { Geo } from "./context.ts";

const decoder = new TextDecoder();

export function parseGeoHeader(geoHeader: string | null) {
  if (geoHeader === null) {
    return {};
  }

  try {
    const decoded = decoder.decode(base64.decode(geoHeader));

    const { postal_code: postalCode, ...rest } = JSON.parse(decoded);
    const geoData: Geo = Object.fromEntries(
      Object.entries({ ...rest, postalCode }).filter(
        ([_, v]) => v !== undefined,
      ),
    );

    return geoData;
  } catch {
    return {};
  }
}
