import type { Context } from "./context.ts";

interface EdgeFunction {
  (
    request: Request,
    context: Context,
  ):
    | Response
    | Promise<Response>
    | Request
    | Promise<Request>
    | void
    | Promise<void>;
}

export type { EdgeFunction };
