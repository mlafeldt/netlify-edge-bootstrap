type Cache = "off" | "manual";

type Path = `/${string}`;

type OnError = "fail" | "bypass" | Path;

export interface Config {
  cache?: Cache;
  excludedPath?: Path | Path[];
  onError?: OnError;
  path?: Path | Path[];
}

export interface IntegrationsConfig extends Config {
  name?: string;
  generator?: string;
}
