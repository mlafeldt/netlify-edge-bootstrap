import type { EdgeFunction } from "./edge_function.ts";

// The stage 2 file exports a `functions` object that maps function names to
// their default exports. In September 2022, we've added an additional export
// called `metadata`, which contains additional information about functions.
// All bundles created after this date should have this export, but we're using
// using an optional property for backwards-compatibility, as it's possible
// we'll still encounter an older bundle that doesn't have it.
export interface Stage2 {
  functions: Functions;
  metadata?: Metadata;
}

export type Functions = Record<string, EdgeFunction | undefined>;

export interface Metadata {
  functions: Record<string, FunctionMetadata>;
}

export interface FunctionMetadata {
  url: string;
}
