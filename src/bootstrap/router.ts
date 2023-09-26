import { EdgeFunction } from "./edge_function.ts";
import { InvocationMetadata } from "./invocation_metadata.ts";
import { StructuredLogger } from "./log/logger.ts";
import type { Functions } from "./stage_2.ts";

interface FunctionConfig {
  excludedPatterns: RegExp[];
  generator?: string;
  onError: string;
}

export interface FunctionMatch {
  config: FunctionConfig;
  name: string;
  path?: string;
  source: EdgeFunction;
}

interface FunctionRoute extends FunctionMatch {
  pattern: RegExp;
  methods: string[];
}

interface FunctionWithConfig {
  config: FunctionConfig;
  source: EdgeFunction;
}

export enum OnError {
  Bypass = "bypass",
  Fail = "fail",
}

export class Router {
  // The functions that should run for the request.
  private functions: Map<string, FunctionWithConfig>;

  // The indexes of the routes that should run for the request.
  private requestRoutes?: number[];

  // All the routes defined for the deploy. Only the routes of the same type
  // are considered — i.e. if the request is for a pre-cache function, only
  // pre-cache routes are present.
  private routes: (FunctionRoute | null)[];

  constructor(
    functions: Functions,
    metadata: InvocationMetadata,
    logger: StructuredLogger,
  ) {
    const rawConfig = metadata.function_config ?? {};
    const functionsWithConfig = new Map<string, FunctionWithConfig>();

    if (Array.isArray(metadata.req_routes)) {
      this.requestRoutes = metadata.req_routes;
    }

    // `rawConfig` is an unsanitized/type-unsafe payload that we receive in the
    // request, so we need to shape it into an interface we can safely use in
    // different places throughout the lifecycle of the request.
    Object.entries(functions).forEach(([name, source]) => {
      if (source === undefined) {
        return;
      }

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
    this.routes = (metadata.routes ?? []).map((route) => {
      const func = functionsWithConfig.get(route.function);

      if (func === undefined) {
        return null;
      }

      return {
        config: func.config,
        name: route.function,
        path: route.path,
        pattern: new RegExp(route.pattern),
        source: func.source,
        methods: route.methods ?? [],
      };
    });
  }

  getFunction(name: string) {
    return this.functions.get(name);
  }

  // Returns the route associated with a given execution index — i.e. the index
  // of the function that is currently executing relative to the list of all
  // functions that may run for the request. This method uses the `req_routes`
  // property from the invocation metadata to match the execution index against
  // a route.
  getRequestRoute(executionIndex: number) {
    if (!this.requestRoutes) {
      return null;
    }

    const routeIndex = this.requestRoutes[executionIndex];

    return this.routes[routeIndex];
  }

  // Returns the functions that should run for a given URL path.
  match(url: URL, method: string): FunctionMatch[] {
    const functions = this.routes.map((route) => {
      if (route === null) {
        return;
      }

      const isMatch = route.pattern.test(url.pathname);

      if (!isMatch) {
        return;
      }

      if (route.methods.length > 0) {
        const matchesMethod = route.methods.includes(method);
        if (!matchesMethod) {
          return;
        }
      }

      const func = this.functions.get(route.name);

      if (func === undefined) {
        return;
      }

      const isExcluded = func.config.excludedPatterns.some((expression) =>
        expression.test(url.pathname)
      );

      if (isExcluded) {
        return;
      }

      // `route` is a `FunctionRoute`, which is a supertype of `FunctionMatch`.
      // We extract and return just the properties that belong in the latter.
      const { config, name, path, source } = route;

      return { config, name, path, source };
    });

    return functions.filter(Boolean) as FunctionMatch[];
  }
}
