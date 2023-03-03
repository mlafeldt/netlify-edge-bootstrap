import "./types.ts";
import { getEnvironment } from "../environment.ts";
import { Metadata } from "../stage_2.ts";
import { StructuredLogger } from "./logger.ts";
import { InternalHeaders } from "../headers.ts";
import { requestStore } from "../request_store.ts";
import { StackTracer } from "../util/stack_tracer.ts";

type LogType = "systemJSON";

export interface NetlifyMetadata {
  edgeFunctionName?: string;
  requestID?: string;
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

      metadata.type = "systemJSON";

      const payload = {
        __nfmessage: message,
        ...fields,
      };

      data = [JSON.stringify(payload)];
    }

    if (metadata.requestID) {
      const chain = requestStore.get(metadata.requestID);
      if (chain) {
        const url = new URL(chain.request.url);
        metadata.url = url.toString();
      }
    }

    return logger(JSON.stringify({ __nfmeta: metadata }), ...data);
  }

  // If this is a system log and we're not in the production environment,
  // we only want to print it when debug logging is enabled.
  if (data[0] instanceof StructuredLogger) {
    const structuredLogger = data[0].serialize();
    const chain = requestStore.get(
      structuredLogger.requestID ?? requestID ?? "",
    );
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

export const patchLogger = (logger: Logger, metadata?: Metadata) => {
  return (...data: unknown[]) => {
    try {
      const { functionName, requestID } = new StackTracer({
        functions: metadata?.functions,
      });

      return instrumentedLog(logger, data, functionName, requestID);
    } catch {
      logger(...data);
    }
  };
};
