import "./types.ts";
import { getEnvironment } from "../environment.ts";
import { FunctionMetadata, Metadata } from "../stage_2.ts";
import { requestStore } from "../handler.ts";
import { StructuredLogger } from "./logger.ts";

export class LogLocation extends Error {
  private functions: Map<string, string>;

  functionName?: string;
  requestID?: string;

  constructor({
    functions = {},
  }: {
    functions?: Record<string, FunctionMetadata>;
  }) {
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

    Error.stackTraceLimit = Infinity;
    Error.prepareStackTrace = (_, callSites) => {
      callSites.forEach((callSite) => {
        const requestID = LogLocation.deserializeRequestID(
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

type LogType = "system" | "systemJSON";

export interface NetlifyMetadata {
  edgeFunctionName?: string;
  requestID?: string;
  requestPath?: string;
  type?: LogType;
  url?: string;
}

export const instrumentedLog = (
  logger: Logger,
  data: unknown[],
  functionName?: string,
  requestID?: string,
) => {
  const environment = getEnvironment();

  if (environment === "production") {
    const metadata: NetlifyMetadata = {
      edgeFunctionName: functionName,
      requestID: requestID,
    };

    if (data[0] instanceof StructuredLogger) {
      const { fields, message, requestID } = data[0].serialize();

      if (requestID) {
        metadata.requestID = requestID;
      }

      if (Object.keys(fields).length === 0) {
        metadata.type = "system";

        data = [message];
      } else {
        metadata.type = "systemJSON";

        const payload = {
          __nfmessage: message,
          ...fields,
        };

        data = [JSON.stringify(payload)];
      }
    }

    if (requestID) {
      const request = requestStore.get(requestID);
      if (request) {
        const url = new URL(request.url);
        metadata.requestPath = url.pathname;
        metadata.url = url.toString();
      }
    }

    return logger(JSON.stringify({ __nfmeta: metadata }), ...data);
  }

  if (functionName) {
    return logger(`[${functionName}]`, ...data);
  }

  return logger(...data);
};

export type Logger = (...data: unknown[]) => void;

export const patchLogger = (logger: Logger, metadata?: Metadata) => {
  return (...data: unknown[]) => {
    try {
      const { functionName, requestID } = new LogLocation({
        functions: metadata?.functions,
      });

      return instrumentedLog(logger, data, functionName, requestID);
    } catch {
      logger(...data);
    }
  };
};
