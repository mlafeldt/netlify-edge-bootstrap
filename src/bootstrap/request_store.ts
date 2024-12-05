import type { FunctionChain } from "./function_chain.ts";

type RequestID = string;
type RequestStore = Map<RequestID, FunctionChain>;

export const requestStore: RequestStore = new Map();
