type Cache = "off" | "manual";

type Path = `/${string}`;

type OnError = "fail" | "bypass" | Path;

type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface Config {
  cache?: Cache;
  excludedPath?: Path | Path[];
  onError?: OnError;
  path?: Path | Path[];
  method?: HTTPMethod | HTTPMethod[];
}

export interface IntegrationsConfig extends Config {
  name?: string;
  generator?: string;
}
