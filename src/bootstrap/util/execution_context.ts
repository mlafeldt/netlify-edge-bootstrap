import { AsyncLocalStorage } from "node:async_hooks";

import { getEnvironment } from "../environment.ts";
import type {
  Context as FunctionContext,
  FunctionChain,
} from "../function_chain.ts";
import { detachedLogger } from "../log/logger.ts";
import { StackTracer } from "./stack_tracer.ts";

export const executionStore = new AsyncLocalStorage<{
  chain: FunctionChain;
  functionIndex: number;
}>();

export const getExecutionContext = (): ExecutionContext | undefined => {
  const executionContext = executionStore.getStore();

  if (!executionContext) {
    return;
  }

  const { chain, functionIndex } = executionContext;

  return {
    chain,
    context: chain.getContext(functionIndex),
    functionName: chain.functionNames[functionIndex],
    requestID: chain.requestID,
    spanID: chain.spanID,
    logToken: chain.logToken,
  };
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
