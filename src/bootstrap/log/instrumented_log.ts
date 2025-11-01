import { getEnvironment } from "../environment.ts";
import { FunctionChain } from "../function_chain.ts";
import { StructuredLogger } from "./logger.ts";
import { InternalHeaders } from "../headers.ts";
import { getExecutionContextAndLogFailure } from "../util/execution_context.ts";

type LogType = "systemJSON";

export interface InstrumentedLogMetadata {
  chain?: FunctionChain;
  functionName?: string;
  requestID?: string;
  spanID?: string;
  logToken?: string;
}

export interface NetlifyMetadata {
  edgeFunctionName?: string;
  requestID?: string;
  spanID?: string;
  type?: LogType;
  url?: string;
  logToken?: string;
}

const isStructuredLogger = (logger: any): logger is StructuredLogger => {
  return Boolean(logger?.__netlifyStructuredLogger);
};

/**
 * Emits a log line annotated with a metadata object. It can be used for both
 * user-facing logs, in which case the metadata object contains information
 * about the function and the request that originated the log, but also for
 * system logs, which will have additional annotations that tell our services
 * to treat the log as internal.
 *
 * @param logger Function that emits the final log output (e.g. `console.log`)
 * @param data Data to be logged
 * @param functionName Name of the function that originated the log
 * @param requestID ID of the request that originated the log
 * @param chain Function chain associated with the request
 */
export const instrumentedLog = (
  logger: Logger,
  data: unknown[],
  metadata?: InstrumentedLogMetadata,
) => {
  const environment = getEnvironment();
  const { chain, functionName, requestID, spanID, logToken: logToken } =
    metadata ??
      {};

  if (environment === "production") {
    const metadata: NetlifyMetadata = {
      edgeFunctionName: functionName,
      requestID: requestID,
      spanID: spanID,
    };

    if (logToken) {
      metadata.logToken = logToken;
    }

    // If the input is a `StructuredLogger` instance, we know we're dealing
    // with a system log, so we add the right metadata object to the payload.
    if (isStructuredLogger(data[0])) {
      const { fields, message, requestID } = data[0].serialize();

      if (requestID) {
        metadata.requestID = requestID;
      }

      metadata.type = "systemJSON";

      const payload = {
        __nfmessage: message,
        ...fields,
      };

      data = [JSON.stringify(payload)];
    }

    // If we have an associated function chain, add the request URL to the
    // metadata object.
    if (chain) {
      const url = new URL(chain.request.url);

      // Deno log lines are cut off after 2048 characters. We don't want the
      // metadata to take up too much of that, so we truncate query parameters
      // if they're taking up too much space. They're ignored in Ingesteer.
      if (url.search.length > 256) {
        url.search = "?query-params-truncated";
      }

      metadata.url = url.toString();
    }

    return logger(JSON.stringify({ __nfmeta: metadata }), ...data);
  }

  // If this is a system log and we're not in the production environment,
  // we only want to print it when debug logging is enabled.
  if (isStructuredLogger(data[0])) {
    const structuredLogger = data[0].serialize();

    if (!chain?.request?.headers.has(InternalHeaders.DebugLogging)) {
      return;
    }

    data = [structuredLogger.message, structuredLogger.fields];
  }

  if (functionName) {
    return logger(`[${functionName}]`, ...data);
  }

  return logger(...data);
};

export type Logger = (...data: unknown[]) => void;

export const patchLogger = (logger: Logger) => {
  return (...data: unknown[]) => {
    try {
      const executionContext = getExecutionContextAndLogFailure(
        "logger",
      );

      return instrumentedLog(
        logger,
        data,
        {
          chain: executionContext?.chain,
          functionName: executionContext?.functionName,
          requestID: executionContext?.requestID,
          spanID: executionContext?.spanID,
          logToken: executionContext?.logToken,
        },
      );
    } catch {
      logger(...data);
    }
  };
};
