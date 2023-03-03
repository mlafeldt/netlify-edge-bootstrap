import type { FunctionChain } from "./function_chain.ts";

type RequestStore = Map<string, FunctionChain>;

export const requestStore: RequestStore = new Map();
