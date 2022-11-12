type Cache = "off" | "manual";

type ConfigFunction = () => ConfigResult | Promise<ConfigResult>;

interface ConfigResult {
  cache?: Cache;
  path?: string;
}

export type Config = ConfigFunction;
