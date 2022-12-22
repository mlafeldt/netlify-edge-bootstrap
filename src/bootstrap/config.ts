type Cache = "off" | "manual";

export interface Config {
  cache?: Cache;
  path?: string;
}
