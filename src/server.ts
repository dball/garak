interface Config {
  port: number;
  logsDir: string;
  pageLength: number;
  maxLineLength: number;
}

const defaultConfig: Config = {
  port: 8000,
  logsDir: "/var/log",
  pageLength: 2 << 19, // 1M
  maxLineLength: 2 << 15, // 64k
};

/**
 * Builds a system config from the the process arguments. If given any invalid
 * or unrecognized arguments, this prints usage information to stderr and exits
 * the process.
 */
const buildConfigFromArgs = (): Config => {
  if (process.argv.length % 2 === 0) {
    let config: Config | null = { ...defaultConfig };
    for (let i = 2; i < process.argv.length && config != null; i += 2) {
      let name = process.argv[i];
      console.log(name);
      if (!name.startsWith("--")) {
        config = null;
        break;
      }
      name = name.substring(2);
      const value = process.argv[i + 1];
      const defaultValue = config[name];
      if (defaultValue == null) {
        config = null;
        break;
      }
      switch (typeof defaultValue) {
        case "string":
          config[name] = value;
          break;
        case "number":
          config[name] = Number(value);
          if (!Number.isSafeInteger(config[name]) || config[name] <= 0) {
            config = null;
          }
          break;
        default:
          config = null;
      }
    }
    if (config != null) {
      return config;
    }
  }
  process.stderr.write(`Invalid arguments\nUsage:\n`);
  for (const name of Object.keys(defaultConfig)) {
    process.stderr.write(`[--${name} <value>]\n`);
  }
  process.exit(1);
};

if (require.main === module) {
  const config = buildConfigFromArgs();
}
