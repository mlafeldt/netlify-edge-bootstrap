import {
  fromFileUrl,
  resolve,
} from "../../vendor/deno.land/std@0.170.0/path/mod.ts";

import { detachedLogger } from "../log/logger.ts";

const depth = Symbol("depth");
const inHandler = Symbol("inHandler");

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

  constructor(functionChainPath: string) {
    OriginalError.stackTraceLimit = STACK_TRACE_LIMIT;

    super();

    this[depth] = 0;
    this[inHandler] = false;

    OriginalError.prepareStackTrace = (_, callSites) => {
      this[depth] = callSites.length;

      for (const callSite of callSites) {
        if (
          callSite.getFileName() === functionChainPath &&
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
      const filename = fromFileUrl(import.meta.url);
      const functionChainPath = resolve(filename, ...FUNCTION_CHAIN_PATH);
      const stackTracer = new StackTracer(functionChainPath);

      return {
        capped: stackTracer[depth] >= STACK_TRACE_LIMIT,
        inHandler: stackTracer[inHandler],
      };
    } catch (error) {
      detachedLogger.withError(error).error("Failed to set up stack tracer");

      return {
        capped: false,
        inHandler: false,
      };
    } finally {
      OriginalError.prepareStackTrace = prepareStackTrace;
      OriginalError.stackTraceLimit = stackTraceLimit;
    }
  }
}
