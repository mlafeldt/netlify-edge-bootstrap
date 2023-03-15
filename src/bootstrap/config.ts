type Cache = "off" | "manual";

type Path = `/${string}`;

export interface Config {
  cache?: Cache;
  path?: Path | Path[];
  excludedPath?: Path | Path[];
}
