type Cache = "off" | "manual";

type Path = `/${string}`;

type OnError = "fail" | "bypass" | Path;

export interface Config {
  cache?: Cache;
  path?: Path | Path[];
  excludedPath?: Path | Path[];
}

export interface IntegrationsConfig extends Config {
  name?: string;
  generator?: string;
  onError?: OnError;
}
