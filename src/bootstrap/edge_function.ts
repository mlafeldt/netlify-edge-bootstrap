import type { Config } from "./config.ts";
import type { Context } from "./context.ts";

interface EdgeFunction {
  (
    request: Request,
    context: Context,
  ):
    | Response
    | Promise<Response>
    | URL
    | Promise<URL>
    | void
    | Promise<void>;
}

// https://fetchable.org: a default export object with a `fetch` method.
interface FetchableEdgeFunction {
  fetch: EdgeFunction;
  config?: Config;
}

type EdgeFunctionExport = EdgeFunction | FetchableEdgeFunction;

const isFetchable = (value: unknown): value is FetchableEdgeFunction =>
  typeof value === "object" && value !== null &&
  typeof (value as FetchableEdgeFunction).fetch === "function";

// Accepts either export shape and returns a callable. Anything else is passed
// through so it fails at invocation time as before.
const toEdgeFunction = (source: EdgeFunctionExport): EdgeFunction =>
  isFetchable(source) ? source.fetch.bind(source) : source;

export { toEdgeFunction };
export type { EdgeFunction, EdgeFunctionExport, FetchableEdgeFunction };
