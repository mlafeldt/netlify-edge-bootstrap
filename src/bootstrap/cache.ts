import cacheControlParser from "https://esm.sh/cache-control-parser@2.0.2";

export const isCacheable = (cacheControl: string | null) => {
  if (!cacheControl) {
    return false;
  }

  try {
    const directives = cacheControlParser.parse(cacheControl);
    const { ["max-age"]: maxAge = 0, ["s-maxage"]: sMaxAge = 0 } = directives;

    return maxAge > 0 || sMaxAge > 0;
  } catch {
    // no-op
  }

  return false;
};
