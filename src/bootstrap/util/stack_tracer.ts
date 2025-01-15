import {
  fromFileUrl,
  resolve,
} from "../../vendor/deno.land/std@0.170.0/path/mod.ts";

import { detachedLogger } from "../log/logger.ts";

const depth = Symbol("depth");
const inHandler = Symbol("inHandler");

let filename: string | undefined;

try {
  filename = fromFileUrl(import.meta.url);
} catch (error) {
  detachedLogger.withError(error).error(
    "Failed to set up stack tracer: could not extract filename from `import.meta.url`",
  );
}

// Relative path from this file to `function_chain.ts`.
const FUNCTION_CHAIN_PATH = ["..", "..", "function_chain.ts"];

// The name of a method inside `function_chain.ts` that is called whenever a
// function is invoked. It's used as a marker to ascertain whether a given call
// has been made inside a function handler.
const MARKER_FUNCTION_NAME = "runFunction";

// Maximum number of call sites to be captured for the stack trace. This has an
// effect on our ability to determine whether a call has been made from inside
// the request handler, since for any call stacks deeper than this limit we
// lose some information and therefore we may get a false negative.
const STACK_TRACE_LIMIT = 50;

// Capturing a reference to the original `Error` global in case it gets mutated
// by user code.
const OriginalError = globalThis.Error;

export class StackTracer extends OriginalError {
  [depth]: number;
  [inHandler]: boolean;

  constructor() {
    OriginalError.stackTraceLimit = STACK_TRACE_LIMIT;

    super();

    this[depth] = 0;
    this[inHandler] = false;

    OriginalError.prepareStackTrace = (_, callSites) => {
      this[depth] = callSites.length;

      const functionChainFilePath = filename
        ? resolve(filename, ...FUNCTION_CHAIN_PATH)
        : undefined;

      for (const callSite of callSites) {
        if (
          callSite.getFileName() === functionChainFilePath &&
          callSite.getFunctionName() === MARKER_FUNCTION_NAME
        ) {
          this[inHandler] = true;

          break;
        }
      }
    };

    // We don't need to do anything with `stack`, but we need to access it for
    // the stack traces to be formatted, triggering `prepareStackTrace`.
    this.stack;
  }

  static capture() {
    const prepareStackTrace = OriginalError.prepareStackTrace;
    const stackTraceLimit = OriginalError.stackTraceLimit;

    try {
      const stackTracer = new StackTracer();

      return {
        capped: stackTracer[depth] >= STACK_TRACE_LIMIT,
        inHandler: stackTracer[inHandler],
      };
    } finally {
      OriginalError.prepareStackTrace = prepareStackTrace;
      OriginalError.stackTraceLimit = stackTraceLimit;
    }
  }
}
