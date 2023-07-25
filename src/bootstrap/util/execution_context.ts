import { FunctionChain } from "../function_chain.ts";
import { requestStore } from "../request_store.ts";
import { Metadata } from "../stage_2.ts";
import { StackTracer } from "./stack_tracer.ts";

interface ExecutionContext {
  chain?: FunctionChain;
  functionName?: string;
  requestID?: string;
}

export const getExecutionContext = (metadata?: Metadata): ExecutionContext => {
  const { functionName, requestID } = new StackTracer({
    functions: metadata?.functions,
  });
  const chain = requestID ? requestStore.get(requestID) : undefined;

  return {
    chain,
    functionName,
    requestID,
  };
};
