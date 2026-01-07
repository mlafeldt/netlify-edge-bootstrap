import { AsyncLocalStorage } from "node:async_hooks";

import { getEnvironment } from "../environment.ts";
import type {
  Context as FunctionContext,
  FunctionChain,
} from "../function_chain.ts";
import { detachedLogger } from "../log/logger.ts";
import { StackTracer } from "./stack_tracer.ts";

// Request-level context available for the entire request handling lifecycle.
// This is set at the start of handleRequest and provides basic metadata for
// logs emitted before/after function execution (e.g. "Started processing").
export interface RequestContext {
  requestID: string;
  spanID: string;
  logToken: string;
}

export const requestStore = new AsyncLocalStorage<RequestContext>();

// Function-level context available during edge function execution.
// This is set when running individual functions and provides the full context.
export const executionStore = new AsyncLocalStorage<{
  chain: FunctionChain;
  functionIndex: number;
}>();

export const getExecutionContext = (): ExecutionContext | undefined => {
  const executionContext = executionStore.getStore();

  // If we're inside function execution, return the full context
  if (executionContext) {
    const { chain, functionIndex } = executionContext;

    return {
      chain,
      context: chain.getContext(functionIndex),
      functionName: chain.functionNames[functionIndex],
      requestID: chain.requestID,
      spanID: chain.spanID,
      logToken: chain.logToken,
    };
  }

  // Fall back to request-level context if available
  const requestContext = requestStore.getStore();
  if (requestContext) {
    return {
      chain: undefined as unknown as FunctionChain,
      context: undefined as unknown as FunctionContext,
      functionName: "",
      requestID: requestContext.requestID,
      spanID: requestContext.spanID,
      logToken: requestContext.logToken,
    };
  }

  return;
};

export interface ExecutionContext {
  chain: FunctionChain;
  context: FunctionContext;
  functionName: string;
  requestID: string;
  spanID: string;
  logToken: string;
}

// To reduce log volume, we use this to keep track of the times we've failed to
// find the execution context for each usage type.
export const loggedFailureTypes = new Set<string>();

export const getExecutionContextAndLogFailure = (type: string) => {
  const executionContext = getExecutionContext();

  if (
    !executionContext && !loggedFailureTypes.has(type) &&
    getEnvironment() === "production"
  ) {
    const { capped, inHandler } = StackTracer.capture();

    if (capped || inHandler) {
      loggedFailureTypes.add(type);

      detachedLogger.withFields({
        capped_stack_trace: capped,
        type,
      }).error(
        "could not find execution context for request correlation",
      );
    }
  }

  return executionContext;
};
