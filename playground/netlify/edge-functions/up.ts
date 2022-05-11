// More on Context and its next() method:
// https://docs.netlify.com/netlify-labs/experimental-features/edge-functions/api/#netlify-specific-context-object
import type { Context } from "https://edge-bootstrap.netlify.app/bootstrap/context.ts";

export default async (_: Request, context: Context) => {
  const res = await context.next();
  const text = await res.text();
  return new Response(text.toUpperCase(), res);
};
