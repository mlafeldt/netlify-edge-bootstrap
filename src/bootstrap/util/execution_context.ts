import { AsyncLocalStorage } from "node:async_hooks";

import type {
  Context as FunctionContext,
  FunctionChain,
} from "../function_chain.ts";
import { detachedLogger } from "../log/logger.ts";

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
  };
};

export interface ExecutionContext {
  chain: FunctionChain;
  context: FunctionContext;
  functionName: string;
  requestID: string;
}

// To reduce log volume, we use this to keep track of the times we've failed to
// find the execution context for each usage type.
const loggedFailureTypes = new Set<string>();

export const getExecutionContextAndLogFailure = (type: string) => {
  const executionContext = getExecutionContext();

  if (!executionContext && !loggedFailureTypes.has(type)) {
    loggedFailureTypes.add(type);

    detachedLogger.withFields({
      stack: new Error().stack,
      type,
    })
      .error("could not find execution context for request correlation");
  }

  return executionContext;
};
