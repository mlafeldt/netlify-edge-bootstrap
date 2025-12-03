import {
  logger,
  LogLevel,
  StructuredLogger,
} from "../../vendor/v1-9-0--edge-utils.netlify.app/logger/mod.ts";
import {
  instrumentedLog,
  type InstrumentedLogMetadata,
} from "./instrumented_log.ts";

const bindRawConsole = (consoleRef: Console) => ({
  error: consoleRef.error.bind(consoleRef),
  log: consoleRef.log.bind(consoleRef),
});

// A reference to console methods that will not go through the request tracking
// logic. We want to use these for log lines emitted by the bootstrap layer,
// leaving the patched methods for user code. This can be re-bound after
// swapping out `globalThis.console` (e.g. when installing NimbleConsole).
let rawConsole = bindRawConsole(globalThis.console);

export const setRawConsole = (consoleRef: Console) => {
  rawConsole = bindRawConsole(consoleRef);
};

// A set of console methods that emit instrumented log lines (i.e. annotated
// with metadata about the request) using the raw console methods.
export const instrumentedConsole = {
  // deno-lint-ignore no-explicit-any
  error: (metadata: InstrumentedLogMetadata, ...data: any[]) =>
    instrumentedLog(rawConsole.error, data, {
      ...metadata,
      logLevel: metadata.logLevel ?? "error",
    }),
  // deno-lint-ignore no-explicit-any
  log: (metadata: InstrumentedLogMetadata, ...data: any[]) =>
    instrumentedLog(rawConsole.log, data, {
      ...metadata,
      logLevel: metadata.logLevel ?? "info",
    }),
};

// A system logger that the raw console methods.
const detachedLogger = logger.withRawLogger((...data) =>
  instrumentedLog(rawConsole.log, data)
);

export { detachedLogger, logger, LogLevel, rawConsole, StructuredLogger };
