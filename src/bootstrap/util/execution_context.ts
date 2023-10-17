import { requestStore } from "../request_store.ts";
import { AsyncLocalStorage } from "node:async_hooks";

const executionStore = new AsyncLocalStorage<{
  requestID: string;
  functionName: string;
}>();

export const getExecutionContext = () => {
  const { functionName, requestID } = executionStore.getStore() || {};
  const chain = requestID ? requestStore.get(requestID) : undefined;

  return {
    chain,
    functionName,
    requestID,
  };
};

export const callWithExecutionContext = executionStore.run.bind(executionStore);
