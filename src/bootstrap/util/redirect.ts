import { Status } from "https://deno.land/std@0.170.0/http/http_status.ts";

// https://github.com/denoland/deno/blob/7ba0d849aa8362091574232484563482f9b6bfe7/ext/fetch/23_response.js#L81-L88
const redirectStatus = new Set([
  Status.MovedPermanently,
  Status.Found,
  Status.SeeOther,
  Status.TemporaryRedirect,
  Status.PermanentRedirect,
]);

// Attempt to detect a response produced by `Response.redirect`. There's no
// unequivocal to assert it, so our best chance is to look for a response
// with the same characteristics. A false positive should be harmless,
// since we'll produce an identical response anyway.
export const isRedirect = (res: Response) => {
  const headers = [...res.headers.keys()];

  return res.body === null && redirectStatus.has(res.status) &&
    headers.length === 1 && headers[0] === "location";
};
