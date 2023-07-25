import { Blobs } from "../vendor/v1-3-0--blobs-js.netlify.app/main.ts";

export { Blobs };

interface BlobsMetadata {
  token?: string;
  url?: string;
}

export function parseBlobsHeader(blobsHeader: string | null): BlobsMetadata {
  if (!blobsHeader) {
    return {};
  }

  try {
    const blobsContext: BlobsMetadata = JSON.parse(atob(blobsHeader));

    return blobsContext;
  } catch {
    return {};
  }
}

export function initializeBlobs(
  metadata: BlobsMetadata,
  siteID?: string,
): Blobs {
  const { token, url } = metadata;

  return new Blobs({
    authentication: {
      contextURL: url,
      token: token ?? "",
    },
    siteID: siteID ?? "",
  });
}
