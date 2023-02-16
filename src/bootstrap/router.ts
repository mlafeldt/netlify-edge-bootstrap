import { EdgeFunction } from "./edge_function.ts";

interface Route {
  function: string;
  pattern: RegExp;
}

export class Router {
  private exclusionPatterns: Map<string, RegExp[]>;
  private functions: Record<string, EdgeFunction>;
  private routes: Route[];

  constructor(
    functions: Record<string, EdgeFunction>,
    metadata: InvocationMetadata,
  ) {
    const exclusionPatterns = new Map<string, RegExp[]>();
    const { function_config: config, routes = [] } = metadata;

    Object.entries(config || {}).forEach(
      ([functionName, { excluded_patterns }]) => {
        if (!excluded_patterns) {
          return;
        }

        const expressions = excluded_patterns.map((pattern) =>
          new RegExp(pattern)
        );
        exclusionPatterns.set(functionName, expressions);
      },
    );

    this.exclusionPatterns = exclusionPatterns;
    this.functions = functions;
    this.routes = routes.map((route) => ({
      function: route.function,
      pattern: new RegExp(route.pattern),
    }));
  }

  // Returns a list of functions that should run for a given URL path.
  match(url: URL) {
    const routes = this.routes.filter((route) => {
      const isMatch = route.pattern.test(url.pathname);

      if (!isMatch) {
        return false;
      }

      const exclusionPatterns = this.exclusionPatterns.get(route.function);
      const isExcluded = (exclusionPatterns ?? []).some((expression) =>
        expression.test(url.pathname)
      );

      return !isExcluded;
    });
    const functions = routes.map((route) => ({
      name: route.function,
      function: this.functions[route.function],
    }));

    return functions;
  }
}

export interface InvocationMetadata {
  function_config?: Record<string, { excluded_patterns: string[] | null }>;
  routes?: { function: string; pattern: string }[];
}

// Parses the header with invocation metadata sent by our edge nodes. It holds
// a Base64-encoded JSON string with the list of all routes and configuration.
export function parseInvocationMetadata(
  routingHeader: string | null,
) {
  if (!routingHeader) {
    return {};
  }

  try {
    const routingData: InvocationMetadata = JSON.parse(atob(routingHeader));

    return routingData;
  } catch {
    throw new Error("Could not parse edge functions invocation metadata");
  }
}
