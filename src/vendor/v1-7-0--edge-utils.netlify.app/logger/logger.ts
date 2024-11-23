type Logger = (...data: unknown[]) => void;

export enum LogLevel {
  Debug = 1,
  Log,
  Error,
}

const serializeError = (error: Error): Record<string, unknown> => {
  const cause = error?.cause instanceof Error
    ? serializeError(error.cause)
    : error.cause;

  return {
    error: error.message,
    error_cause: cause,
    error_stack: error.stack,
  };
};

export class StructuredLogger {
  private fields: Record<string, unknown>;
  private logLevel: LogLevel;
  private message: string;
  private rawLogger?: Logger;
  private requestID?: string;
  __netlifyStructuredLogger: number;

  constructor(
    message?: string,
    fields?: Record<string, unknown>,
    requestID?: string,
    rawLogger?: Logger,
    logLevel?: LogLevel,
  ) {
    this.fields = fields ?? {};
    this.logLevel = logLevel ?? LogLevel.Log;
    this.message = message ?? "";
    this.rawLogger = rawLogger;
    this.requestID = requestID;

    // Value should be equal to the major version
    this.__netlifyStructuredLogger = 1;
  }

  debug(message: string) {
    if (this.logLevel > LogLevel.Debug) {
      return;
    }

    const logger = this.rawLogger ?? globalThis.console.log;

    logger(
      new StructuredLogger(
        message,
        this.fields,
        this.requestID,
        this.rawLogger,
        this.logLevel,
      ),
    );
  }

  error(message: string) {
    if (this.logLevel > LogLevel.Error) {
      return;
    }

    const logger = this.rawLogger ?? globalThis.console.log;

    logger(
      new StructuredLogger(
        message,
        this.fields,
        this.requestID,
        this.rawLogger,
        this.logLevel,
      ),
    );
  }

  log(message: string) {
    if (this.logLevel > LogLevel.Log) {
      return;
    }

    const logger = this.rawLogger ?? globalThis.console.log;

    logger(
      new StructuredLogger(
        message,
        this.fields,
        this.requestID,
        this.rawLogger,
        this.logLevel,
      ),
    );
  }

  serialize() {
    const log = {
      fields: this.fields,
      message: this.message,
      requestID: this.requestID,
    };

    return log;
  }

  withError(error: unknown) {
    const fields = error instanceof Error ? serializeError(error) : { error };

    return this.withFields(fields);
  }

  withFields(fields: Record<string, unknown>) {
    return new StructuredLogger(
      this.message,
      {
        ...this.fields,
        ...fields,
      },
      this.requestID,
      this.rawLogger,
      this.logLevel,
    );
  }

  withLogLevel(logLevel: LogLevel) {
    return new StructuredLogger(
      this.message,
      this.fields,
      this.requestID,
      this.rawLogger,
      logLevel,
    );
  }

  withRawLogger(logger: Logger) {
    return new StructuredLogger(
      this.message,
      this.fields,
      this.requestID,
      logger,
      this.logLevel,
    );
  }

  withRequestID(requestID: string | null) {
    if (requestID === null) {
      return this;
    }

    return new StructuredLogger(
      this.message,
      this.fields,
      requestID,
      this.rawLogger,
      this.logLevel,
    );
  }
}

export const logger = new StructuredLogger();
