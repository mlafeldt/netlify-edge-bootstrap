import type { Context } from "../context.ts";
import { requestStore } from "../request_store.ts";
import { AsyncLocalStorage } from "node:async_hooks";

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

export const callWithExecutionContext = executionStore.run.bind(executionStore);
