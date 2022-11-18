export interface Geo {
  city?: string;
  country?: {
    code?: string;
    name?: string;
  };
  subdivision?: {
    code?: string;
    name?: string;
  };
  timezone?: string;
  latitude?: number;
  longitude?: number;
}

export function parseGeoHeader(geoHeader: string | null) {
  if (geoHeader === null) {
    return {};
  }

  try {
    const geoData: Geo = JSON.parse(geoHeader);

    return geoData;
  } catch {
    return {};
  }
}
