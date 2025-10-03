import { EdgeFunction } from "./edge_function.ts";
import { isInternalHeader } from "./headers.ts";
import { RequestInvocationMetadata } from "./invocation_metadata.ts";
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
  methods?: Set<string>;
  header?: Record<string, boolean | RegExp | null>;
}

interface FunctionWithConfig {
  config: FunctionConfig;
  source: EdgeFunction;
}

export enum OnError {
  Bypass = "bypass",
  Fail = "fail",
}

// Global cache for compiled regex patterns to avoid recompiling the same
// pattern across multiple routes
const regexCache = new Map<string, RegExp | null>();

function getOrCompileRegex(pattern: string): RegExp | null {
  let regex = regexCache.get(pattern);
  if (!regex) {
    try {
      regex = new RegExp(pattern);
    } catch {
      // Invalid regex: use null to preserve previous
      // behavior (header condition fails for this route).
      regex = null;
    }
    regexCache.set(pattern, regex);
  }
  return regex;
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
    metadata: RequestInvocationMetadata,
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

      // Precompile header matchers: normalize header names to lowercase and
      // convert string values to RegExp once, so `match()` doesn't need to
      // construct regexes per request.
      let compiledHeader: Record<string, boolean | RegExp | null> | undefined;
      if (route.header) {
        compiledHeader = {};
        for (const [name, value] of Object.entries(route.header)) {
          const key = name.toLowerCase();

          if (typeof value === "boolean") {
            compiledHeader[key] = value;
          } else if (typeof value === "string") {
            compiledHeader[key] = getOrCompileRegex(value);
          }
        }
      }

      return {
        config: func.config,
        name: route.function,
        path: route.path,
        pattern: new RegExp(route.pattern),
        source: func.source,
        methods: route.methods && route.methods.length > 0
          ? new Set(route.methods)
          : undefined,
        header: compiledHeader,
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
  match(url: URL, req: Request): FunctionMatch[] {
    const functions: FunctionMatch[] = [];

    routeLoop: for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i];

      if (route === null) {
        continue;
      }

      const isMatch = route.pattern.test(url.pathname);

      if (!isMatch) {
        continue;
      }

      if (route.methods && route.methods.size > 0) {
        const matchesMethod = route.methods.has(req.method);
        if (!matchesMethod) {
          continue;
        }
      }

      const func = this.functions.get(route.name);

      if (func === undefined) {
        continue;
      }

      const isExcluded = func.config.excludedPatterns.some((expression) =>
        expression.test(url.pathname)
      );

      if (isExcluded) {
        continue;
      }

      // Check header matching conditions using precompiled matchers
      if (route.header) {
        for (const [headerName, matcher] of Object.entries(route.header)) {
          // Exclude internal headers from matching semantics
          if (isInternalHeader(headerName)) {
            continue;
          }

          const rawValue = req.headers.get(headerName);
          const requestHeaderValue = rawValue?.split(", ").join(",");

          if (typeof matcher === "boolean") {
            if (matcher !== Boolean(requestHeaderValue)) {
              continue routeLoop;
            }
          } else if (matcher instanceof RegExp) {
            if (!requestHeaderValue) {
              continue routeLoop;
            }

            if (!matcher.test(requestHeaderValue)) {
              continue routeLoop;
            }
          } else {
            continue routeLoop;
          }
        }
      }

      // `route` is a `FunctionRoute`, which is a supertype of `FunctionMatch`.
      // We extract and return just the properties that belong in the latter.
      const { config, name, path, source } = route;

      functions.push({ config, name, path, source });
    }

    return functions;
  }
}
