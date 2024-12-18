import {
  logger,
  LogLevel,
  StructuredLogger,
} from "../../vendor/v1-7-0--edge-utils.netlify.app/logger/mod.ts";
import { instrumentedLog } from "./instrumented_log.ts";

const rawConsole = globalThis.console;

// An instance of `StructuredLogger` that uses an unpatched `console.log`. In
// practice, this makes it detached from the context-tracking logic, and can
// be used in situations where tracking the context is not necessary.
const detachedLogger = logger.withRawLogger((...data) =>
  instrumentedLog(rawConsole.log, data)
);

export { detachedLogger, logger, LogLevel, rawConsole, StructuredLogger };
