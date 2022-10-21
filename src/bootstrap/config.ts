type Mode = "before-cache" | "after-cache";

type ConfigFunction = () => ConfigResult | Promise<ConfigResult>;

interface ConfigResult {
  mode?: Mode;
  path?: string;
}

export type Config = ConfigFunction;
