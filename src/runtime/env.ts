interface EnvShim {
  delete(key: string): void;
  get(key: string): string | undefined;
  has(key: string): boolean;
  set(key: string, value: string): void;
  toObject(): Record<string, string>;
}

const denoEnv: EnvShim | undefined = globalThis.Deno?.env;
const processEnv: Record<string, string | undefined> | undefined = globalThis
  ?.process?.env;

const processEnvShim: EnvShim = {
  delete: (key) => {
    if (processEnv) {
      delete processEnv[key];
    }
  },
  get: (key) => processEnv?.[key],
  has: (key) =>
    Boolean(
      processEnv && Object.prototype.hasOwnProperty.call(processEnv, key),
    ),
  set: (key, value) => {
    if (processEnv) {
      processEnv[key] = value;
    }
  },
  toObject: () => {
    if (!processEnv) {
      return {};
    }

    const entries = Object.entries(processEnv).filter(
      ([, value]) => typeof value === "string",
    ) as [string, string][];

    return Object.fromEntries(entries);
  },
};

export const env: EnvShim = denoEnv ?? processEnvShim;
