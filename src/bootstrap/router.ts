import { InvocationMetadata } from "./invocation_metadata.ts";
import { StructuredLogger } from "./log/logger.ts";
import type { Functions } from "./stage_2.ts";

interface Route {
  function: string;
  pattern: RegExp;
}

export enum OnError {
  Bypass = "bypass",
  Fail = "fail",
}

export class Router {
  private exclusionPatterns: Map<string, RegExp[]>;
  private functions: Functions;
  private onErrorSettings: Map<string, string>;
  private routes: Route[];

  constructor(
    functions: Functions,
    metadata: InvocationMetadata,
    logger: StructuredLogger,
  ) {
    const exclusionPatterns = new Map<string, RegExp[]>();
    const onErrorSettings = new Map<string, string>();

    const config = metadata.function_config ?? {};
    const routes = metadata.routes ?? [];

    Object.entries(config).forEach(
      ([functionName, functionConfig]) => {
        const {
          excluded_patterns: excludedPatterns,
          on_error: onError,
        } = functionConfig;

        if (excludedPatterns) {
          const expressions = excludedPatterns.map((pattern) =>
            new RegExp(pattern)
          );

          exclusionPatterns.set(functionName, expressions);
        }

        if (onError) {
          if (
            onError === OnError.Bypass ||
            onError === OnError.Fail ||
            (typeof onError === "string" && onError.startsWith("/"))
          ) {
            onErrorSettings.set(functionName, onError);
          } else {
            logger.withFields({ onError }).log(
              "Found unexpected value for 'on_error' property",
            );
          }
        }
      },
    );

    this.exclusionPatterns = exclusionPatterns;
    this.onErrorSettings = onErrorSettings;
    this.functions = functions;
    this.routes = routes.map((route) => ({
      function: route.function,
      pattern: new RegExp(route.pattern),
    }));
  }

  getOnError(functionName: string) {
    return this.onErrorSettings.get(functionName) ?? OnError.Fail;
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
