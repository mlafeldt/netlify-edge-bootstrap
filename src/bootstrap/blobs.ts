import * as base64 from "https://deno.land/std@0.170.0/encoding/base64.ts";

import type { Deploy, Site } from "./context.ts";

declare global {
  // Using `var` so that the declaration is hoisted in such a way that we can
  // reference it before it's initialized.
  // deno-lint-ignore no-var
  var netlifyBlobsContext: unknown;
}

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
  uncachedEdgeURL?: string;
}

/**
 * Payload sent by our edge nodes as part of the invocation with metadata about
 * Blobs, including the URL of the edge endpoint and the access token.
 */
export interface BlobsMetadata {
  token?: string;
  url?: string;
  url_uncached?: string;
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
  const { token, url, url_uncached: uncachedURL } = metadata;

  if (!token || !url || !site.id) {
    return;
  }

  const context: BlobsContext = {
    deployID: deploy.id,
    edgeURL: url,
    siteID: site.id,
    token,
    uncachedEdgeURL: uncachedURL,
  };

  globalThis.netlifyBlobsContext = base64.encode(JSON.stringify(context));
}
