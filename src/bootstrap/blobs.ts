import * as base64 from "https://deno.land/std@0.170.0/encoding/base64.ts";

import type { Deploy, Site } from "./context.ts";

/**
 * The name of the environment variable that holds the context in a Base64,
 * JSON-encoded object. If we ever need to change the encoding or the shape
 * of this object, we should bump the version and create a new variable, so
 * that the client knows how to consume the data and can advise the user to
 * update the client if needed.
 *
 * @see {@link https://github.com/netlify/blobs/blob/68f58181bd60687797557444a1efe1861324deb1/src/environment.ts}
 */
const BLOBS_CONTEXT_VARIABLE = "NETLIFY_BLOBS_CONTEXT";

/**
 * Payload expected by the Blobs client as an environment variable, so that
 * user code can initialize a store without providing any metadata.
 *
 * @see {@link https://github.com/netlify/blobs/blob/68f58181bd60687797557444a1efe1861324deb1/src/environment.ts}
 */
interface BlobsContext {
  deployID?: string;
  edgeURL: string;
  siteID: string;
  token: string;
}

/**
 * Payload sent by our edge nodes as part of the invocation with metadata about
 * Blobs, including the URL of the edge endpoint and the access token.
 */
export interface BlobsMetadata {
  token?: string;
  url?: string;
}

export function parseBlobsMetadata(blobsHeader: string | null): BlobsMetadata {
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

export function setBlobsContext(
  metadata: BlobsMetadata,
  deploy: Deploy,
  site: Site,
) {
  const { token, url } = metadata;

  if (!token || !url || !site.id) {
    return;
  }

  const context: BlobsContext = {
    deployID: deploy.id,
    edgeURL: url,
    siteID: site.id,
    token,
  };

  Deno.env.set(BLOBS_CONTEXT_VARIABLE, base64.encode(JSON.stringify(context)));
}
