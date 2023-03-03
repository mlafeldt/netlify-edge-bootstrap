import { InvocationMetadata } from "./invocation_metadata.ts";
import type { Functions } from "./stage_2.ts";

interface Route {
  function: string;
  pattern: RegExp;
}

export class Router {
  private exclusionPatterns: Map<string, RegExp[]>;
  private functions: Functions;
  private routes: Route[];

  constructor(
    functions: Functions,
    metadata: InvocationMetadata,
  ) {
    const exclusionPatterns = new Map<string, RegExp[]>();
    const config = metadata.function_config ?? {};
    const routes = metadata.routes ?? [];

    Object.entries(config).forEach(
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

  getFunction(name: string) {
    return this.functions[name];
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
