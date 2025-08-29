import type { EdgeFunction } from "./edge_function.ts";

export interface Stage2 {
  functions: Functions;
}

export type Functions = Record<string, EdgeFunction | undefined>;

export interface FunctionMetadata {
  url: string;
}
