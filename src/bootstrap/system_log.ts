import type { NetlifyMetadata } from "./log/log_location.ts";

export const systemLogSymbol = Symbol("systemLog");

export class StructuredLogger {
  private fields: Record<string, unknown>;
  private requestID?: string;

  constructor(
    fields?: Record<string, unknown>,
    requestID?: string,
  ) {
    this.fields = fields ?? {};
    this.requestID = requestID;
  }

  private serialize(message: string) {
    const metadata: NetlifyMetadata = {};
    const hasFields = Object.keys(this.fields).length !== 0;

    if (this.requestID) {
      metadata.requestID = this.requestID;
    }

    if (!hasFields) {
      console.log(systemLogSymbol, { ...metadata, type: "system" }, message);

      return;
    }

    const payload = {
      __nfmessage: message,
      ...this.fields,
    };

    console.log(
      systemLogSymbol,
      { ...metadata, type: "systemJSON" },
      JSON.stringify(payload),
    );
  }

  log(message: string) {
    return this.serialize(message);
  }

  withFields(fields: Record<string, unknown>) {
    return new StructuredLogger({
      ...this.fields,
      ...fields,
    }, this.requestID);
  }

  withRequestID(requestID: string | null) {
    if (requestID === null) {
      return this;
    }

    return new StructuredLogger(this.fields, requestID);
  }
}

export const logger = new StructuredLogger();

// Legacy function. Should be deprecated.
// @deprecated
export const systemLog = (...data: unknown[]) => logger.log(data.join(" "));
