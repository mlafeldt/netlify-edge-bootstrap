import { FunctionMetadata } from "../stage_2.ts";

export class StackTracer extends Error {
  private functions: Map<string, string>;

  functionName?: string;
  requestID?: string;

  constructor({
    functions = {},
  }: {
    functions?: Record<string, FunctionMetadata>;
  }) {
    Error.stackTraceLimit = 50;

    super();

    this.functions = new Map();

    // `functions` is a hash mapping function names to file URLs, but we want
    // the opposite. We'll be looking up a lot of file names in order to find
    // out whether they match a function, so let's store a map of file URLs
    // to function names.
    Object.keys(functions).forEach((functionName) => {
      const { url } = functions[functionName];

      if (!url) {
        return;
      }

      this.functions.set(url, functionName);
    });

    const prepareStackTrace = Error.prepareStackTrace;
    const stackTraceLimit = Error.stackTraceLimit;

    Error.prepareStackTrace = (_, callSites) => {
      callSites.forEach((callSite) => {
        const requestID = StackTracer.deserializeRequestID(
          callSite.getFunctionName(),
        );

        // If the function name matches the format for the request ID wrapper,
        // extract the request ID. Even if what we're looking at is a function
        // in user code that happens to have the same name as our wrapper for
        // some reason, we'll still end up finding the right request ID as we
        // traverse through the call sites (ours will always be deeper in the
        // stack trace).
        if (requestID !== undefined) {
          this.requestID = requestID;
        }

        const functionName = this.getFunctionName(callSite.getFileName());

        if (functionName) {
          this.functionName = functionName;
        }
      });
    };

    // We don't need to do anything with `stack`, but we need to access it for
    // the stack traces to be formatted, triggering `prepareStackTrace`.
    this.stack;

    Error.prepareStackTrace = prepareStackTrace;
    Error.stackTraceLimit = stackTraceLimit;
  }

  private static requestIDPrefix = "nf_req_";

  private static deserializeRequestID(input: string | null) {
    if (!input?.startsWith(this.requestIDPrefix)) {
      return;
    }

    return input.slice(this.requestIDPrefix.length);
  }

  static serializeRequestID(requestID: string | null) {
    return this.requestIDPrefix + (requestID ?? "unknown");
  }

  private getFunctionName(filePath: string | null) {
    if (!filePath) {
      return;
    }

    return this.functions.get(filePath);
  }
}
