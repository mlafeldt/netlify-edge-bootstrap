import { EdgeFunction } from "./edge_function.ts";
import { InvocationMetadata } from "./invocation_metadata.ts";
import { StructuredLogger } from "./log/logger.ts";
import type { Functions } from "./stage_2.ts";

interface FunctionConfig {
  excludedPatterns: RegExp[];
  generator?: string;
  onError: string;
}

interface FunctionWithConfig {
  config: FunctionConfig;
  source: EdgeFunction;
}

interface Route {
  function: string;
  pattern: RegExp;
}

interface RouteMatch {
  function: EdgeFunction;
  name: string;
}

export enum OnError {
  Bypass = "bypass",
  Fail = "fail",
}

export class Router {
  private functions: Map<string, FunctionWithConfig>;
  private routes: Route[];

  constructor(
    functions: Functions,
    metadata: InvocationMetadata,
    logger: StructuredLogger,
  ) {
    const rawConfig = metadata.function_config ?? {};
    const functionsWithConfig = new Map();

    // `rawConfig` is an unsanitized/type-unsafe payload that we receive in the
    // request, so we need to shape it into an interface we can safely use in
    // different places throughout the lifecycle of the request.
    Object.entries(functions).forEach(([name, source]) => {
      const config: FunctionConfig = {
        excludedPatterns: [],
        onError: OnError.Fail,
      };
      const {
        excluded_patterns: excludedPatterns,
        generator,
        on_error: onError,
      } = rawConfig[name] ?? {};

      if (excludedPatterns) {
        const expressions = excludedPatterns.map((pattern) =>
          new RegExp(pattern)
        );

        config.excludedPatterns.push(...expressions);
      }

      if (onError) {
        if (
          onError === OnError.Bypass ||
          onError === OnError.Fail ||
          (typeof onError === "string" && onError.startsWith("/"))
        ) {
          config.onError = onError;
        } else {
          logger.withFields({ onError }).log(
            "Found unexpected value for 'on_error' property",
          );
        }
      }

      if (generator) {
        config.generator = generator;
      }

      functionsWithConfig.set(name, { config, source });
    });

    this.functions = functionsWithConfig;
    this.routes = (metadata.routes ?? []).map((route) => ({
      function: route.function,
      pattern: new RegExp(route.pattern),
    }));
  }

  getFunction(name: string) {
    return this.functions.get(name);
  }

  // Returns a list of functions that should run for a given URL path.
  match(url: URL) {
    const functions = this.routes.map((route) => {
      const isMatch = route.pattern.test(url.pathname);

      if (!isMatch) {
        return;
      }

      const func = this.functions.get(route.function);

      if (func === undefined) {
        return;
      }

      const isExcluded = func.config.excludedPatterns.some((expression) =>
        expression.test(url.pathname)
      );

      if (isExcluded) {
        return;
      }

      return {
        function: func.source,
        name: route.function,
      };
    });

    return functions.filter(Boolean) as RouteMatch[];
  }
}
