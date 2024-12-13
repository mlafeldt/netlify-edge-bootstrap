import { AsyncLocalStorage } from "node:async_hooks";

import type { Context } from "../context.ts";
import { detachedLogger } from "../log/logger.ts";
import { requestStore } from "../request_store.ts";

const executionStore = new AsyncLocalStorage<{
  context: Context;
  requestID: string;
  functionName: string;
}>();

export const getExecutionContext = () => {
  const { context, functionName, requestID } = executionStore.getStore() || {};
  const chain = requestID ? requestStore.get(requestID) : undefined;

  return {
    chain,
    context,
    functionName,
    requestID,
  };
};

// To reduce log volume, we use this to keep track of the times we've failed to
// find the execution context for each usage type.
const loggedFailureTypes = new Set<string>();

export const getExecutionContextAndLogFailure = (type: string) => {
  const result = getExecutionContext();

  if (!result.chain && !loggedFailureTypes.has(type)) {
    loggedFailureTypes.add(type);

    detachedLogger.withFields({
      tracked_context: Boolean(result.requestID),
      type,
    })
      .error("could not find execution context for request correlation");
  }

  return result;
};

export const callWithExecutionContext = executionStore.run.bind(executionStore);
