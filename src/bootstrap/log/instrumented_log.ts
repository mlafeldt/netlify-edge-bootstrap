import { getEnvironment } from "../environment.ts";
import { FunctionChain } from "../function_chain.ts";
import { StructuredLogger } from "./logger.ts";
import { InternalHeaders } from "../headers.ts";
import { getExecutionContextAndLogFailure } from "../util/execution_context.ts";

type LogType = "systemJSON";

export interface NetlifyMetadata {
  edgeFunctionName?: string;
  requestID?: string;
  type?: LogType;
  url?: string;
}

const isStructuredLogger = (logger: any): logger is StructuredLogger => {
  return Boolean(logger?.__netlifyStructuredLogger);
};

export const instrumentedLog = (
  logger: Logger,
  data: unknown[],
  functionName?: string,
  requestID?: string,
  chain?: FunctionChain,
) => {
  const environment = getEnvironment();

  if (environment === "production") {
    const metadata: NetlifyMetadata = {
      edgeFunctionName: functionName,
      requestID: requestID,
    };

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
        executionContext?.functionName,
        executionContext?.requestID,
        executionContext?.chain,
      );
    } catch {
      logger(...data);
    }
  };
};
