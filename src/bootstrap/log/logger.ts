import {
  logger,
  LogLevel,
  StructuredLogger,
} from "https://v1-7-0--edge-utils.netlify.app/logger/mod.ts";

// An instance of `StructuredLogger` that uses an unpatched `console.log`. In
// practice, this makes it detached from the context-tracking logic, and can
// be used in situations where tracking the context is not necessary.
const detachedLogger = logger.withRawLogger(globalThis.console.log);

export { detachedLogger, logger, LogLevel, StructuredLogger };
