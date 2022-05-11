// More on Context and its next() method:
// https://docs.netlify.com/netlify-labs/experimental-features/edge-functions/api/#netlify-specific-context-object
import type { Context } from "netlify:edge";

export default async (_: Request, context: Context) => {
  const res = await context.next();
  const text = await res.text();
  return new Response(text.toUpperCase(), res);
};
