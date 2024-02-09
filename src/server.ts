import * as http from "node:http";
import * as querystring from "node:querystring";
import * as Koa from "koa";
import * as logs from "./logs";

export interface Config {
  port: number;
  logsDir: string;
  pageLength: number;
  maxLineLength: number;
  algo: "reverse" | "stream";
}

const defaultConfig: Config = {
  port: 8000,
  logsDir: "/var/log",
  pageLength: 2 << 19, // 1M
  maxLineLength: 2 << 15, // 64k
  algo: "reverse",
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
          // All of our numbers are positive integers, so we don't need to
          // bother with a stronger schema.
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
  console.error(`Invalid arguments\nUsage:`);
  for (const name of Object.keys(defaultConfig)) {
    console.error(`[--${name} <value>]`);
  }
  process.exit(1);
};

const buildSearch = (
  config: Config,
  query: querystring.ParsedUrlQuery
): logs.Search | null => {
  const { file, total, keywords } = query;
  if (typeof file !== "string") {
    return null;
  }
  // Note if total should not actually be required, setting the search entry
  // value to positive infinity is acceptable.
  if (typeof total !== "string") {
    return null;
  }
  let totalNumber = Number(total);
  if (!Number.isSafeInteger(totalNumber) || totalNumber < 0) {
    return null;
  }
  let pred: (buffer: Buffer) => boolean;
  if (keywords == null) {
    pred = () => true;
  } else {
    // Some keywords would be silly, like empty string or newline, but I don't
    // think any are invalid per se.
    let keywordsArray: Array<Buffer>;
    if (typeof keywords === "string") {
      keywordsArray = [Buffer.from(keywords)];
    } else {
      keywordsArray = keywords.map(Buffer.from);
    }
    pred = (buffer: Buffer) => {
      // A regular expression engine would probably be more efficient, though
      // that would also suggest or require stronger validation of the keywords
      // to prevent computation denial of service attacks with lookbehind
      // patterns and the like.
      //
      // We could also say that this should be the domain of the logs package
      // and change the search entry from pred to keywords.
      return keywordsArray.every((keyword) => buffer.includes(keyword));
    };
  }
  return {
    maxLineLength: config.maxLineLength,
    pageLength: config.pageLength,
    logsDir: config.logsDir,
    file,
    total: totalNumber,
    pred,
  };
};

const buildApp = (config: Config): Koa => {
  const finderBuilder =
    config.algo === "reverse"
      ? logs.buildReverseLineFinder
      : logs.buildStreamLineFinder;
  const app = new Koa();
  app.use(async (ctx, next) => {
    const { method, path, query } = ctx;
    if (method === "GET" && path === "/logs") {
      const search = buildSearch(config, query);
      const lineFinder = search && (await finderBuilder(search));
      if (lineFinder == null) {
        ctx.set("Content-Type", "text/plain");
        // We should, of course, be more specific in reporting the reasons.
        ctx.body = `Invalid search\n`;
        ctx.status = 422;
      } else {
        console.debug("Searching", search);
        ctx.status = 200;
        ctx.set("Content-Type", "application/octet-stream");
        ctx.flushHeaders();
        const writer = ctx.res;
        try {
          for await (const line of lineFinder.findLatestLines()) {
            // We're basically handling our own backpressure here instead of
            // using a stream construct, but this is the only way I could get
            // messages not to buffer. In this case, we prefer messages
            // delivered immediately, so when searching large files for
            // infrequent matches, the caller sees them as we find them.
            await new Promise<void>((resolve, reject) => {
              const notFull = writer.write(line, (err) => {
                writer.removeListener("drain", resolve);
                reject(err);
              });
              if (notFull) {
                resolve();
              } else {
                writer.addListener("drain", resolve);
              }
            });
          }
          writer.end();
        } catch (err) {
          if (err.code === "ERR_STREAM_DESTROYED") {
            // Is there a cleaner way to get this before trying to write?
            // Seems like there'd always be a race condition.
            console.debug(`Caller closed connection`, { search });
            // When the generator is collected, the finally block is
            // called and the file handle is also collected.
          } else {
            console.error(`Stream error`, { search, err, code: err.code });
            // We've already written success, so the best we can do when
            // streaming is clearly indicate an error condition, though it's
            // worth noting that there is no unambiguous way to distinguish this
            // condition from this exact message occuring in the corpus. If that
            // is significant, we should introduce our own control and data
            // message wrappers.
            try {
              writer.end(`Premature end of stream\n`);
            } catch (e) {
              console.error(`Error reporting stream error`, { err: e });
            }
          }
        }
      }
    }
    return next();
  });
  return app;
};

interface System {
  start: () => Promise<Config>;
  stop: () => Promise<void>;
}

export const buildSystem = (config: Config): System => {
  let server: http.Server | undefined;
  let port = config.port;
  return {
    start: async () => {
      await new Promise<void>((resolve, reject) => {
        const app = buildApp(config);
        server = app.listen(config.port);
        server.once("listening", resolve);
        server.once("error", reject);
      });
      if (server != null) {
        const address = server.address();
        if (address != null && typeof address !== "string") {
          port = address.port;
        }
      }
      return { ...config, port };
    },
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server?.closeIdleConnections();
        server?.close((err) => {
          if (err == null) {
            resolve();
          } else {
            reject(err);
          }
        });
      });
      server = undefined;
    },
  };
};

const main = async () => {
  const config = buildConfigFromArgs();
  const system = buildSystem(config);
  const shutdown = async () => {
    try {
      await system.stop();
      console.info(`Garak shutdown complete`);
    } catch (err) {
      console.error(`Garak shutdown error`, err);
      process.exit(2);
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  const { port } = await system.start();
  console.info(`Garak listening on http://localhost:${port}`);
};

if (require.main === module) {
  main();
}
