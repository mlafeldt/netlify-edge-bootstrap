export interface Site {
  id?: string;
  name?: string;
  url?: string;
}

export function parseSiteHeader(siteHeader: string | null): Site {
  if (!siteHeader) {
    return {};
  }

  try {
    const siteData: Site = JSON.parse(atob(siteHeader));

    return siteData;
  } catch {
    return {};
  }
}
