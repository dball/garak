import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as server from "./server";

const testLogDir = path.join(__dirname, "..", "tmp");

/**
 * If large.log does not exist, this creates and writes to it with over a
 * gigabyte of synthetic, pure log lines, suitable for use by tests.
 *
 * It will throw on any filesystem error.
 */
// A useful stress test: curl 'http://localhost:8000/logs?file=large.log&total=10&keywords=odd&keywords=9111111'
const writeTestFiles = async () => {
  await fs.mkdir(testLogDir, { recursive: true });
  const largeFilePath = path.resolve(testLogDir, "large.log");
  try {
    await fs.stat(largeFilePath);
    // If the file exists, we assume it's good. If that becomes troublesome, we
    // could check the size or just write it anew every time.
    return;
  } catch (err) {}
  console.log("Writing large test file, this may take a while");
  const fd = await fs.open(
    largeFilePath,
    fs.constants.O_CREAT | fs.constants.O_WRONLY,
    0o644
  );
  const writer = fd.createWriteStream();
  // It would probably be more efficient to batch the lines, reducing the
  // promise allocations and event loop registrations, but this runs in a minute
  // or so on my box, so good enough for now.
  for (let i = 0; i < 10e7; i++) {
    const line = `${i} is ${i % 2 === 0 ? "even" : "odd"}\n`;
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
  await new Promise((resolve, reject) => {
    writer.close((err) => {
      if (err == null) {
        resolve(true);
      } else {
        reject(err);
      }
    });
  });
};

describe("server", () => {
  const config: server.Config = {
    port: 0, // This tells node to assign us a random free port
    logsDir: testLogDir,
    pageLength: 2 << 19, // 1M
    maxLineLength: 2 << 15, // 64k
  };
  const system = server.buildSystem(config);
  let port = 0;

  beforeAll(async () => {
    try {
      await writeTestFiles();
    } catch (err) {
      console.log(`Error writing test files, aborting`, err);
      process.exit(3);
    }
    const started = await system.start();
    port = started.port;
  });

  afterAll(async () => {
    await system.stop();
  });

  it("returns a 404 for the root path", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toEqual(404);
  });

  it("returns the requested number of entries in a valid log file", async () => {
    const res = await fetch(
      `http://localhost:${port}/logs?file=large.log&total=3`
    );
    expect(res.status).toEqual(200);
    const body = await res.text();
    expect(body).toEqual(
      `99999999 is odd\n99999998 is even\n99999997 is odd\n`
    );
  });

  it("returns the requested number of matching entries in a valid log file", async () => {
    const res = await fetch(
      `http://localhost:${port}/logs?file=large.log&total=2&keywords=odd`
    );
    expect(res.status).toEqual(200);
    const body = await res.text();
    expect(body).toEqual(`99999999 is odd\n99999997 is odd\n`);
  });

  it("returns the requested number of matching joined entries in a valid log file", async () => {
    const res = await fetch(
      `http://localhost:${port}/logs?file=large.log&total=1&keywords=odd&keywords=1`
    );
    expect(res.status).toEqual(200);
    const body = await res.text();
    expect(body).toEqual(`99999991 is odd\n`);
  });

  it("rejects no specified log file", async () => {
    const res = await fetch(`http://localhost:${port}/logs`);
    expect(res.status).toEqual(422);
  });

  it("rejects a missing log file", async () => {
    const res = await fetch(`http://localhost:${port}/logs?file=missing.log`);
    expect(res.status).toEqual(422);
  });

  it("rejects an invalid total", async () => {
    const res = await fetch(
      `http://localhost:${port}/logs?file=large.log&total=-1`
    );
    expect(res.status).toEqual(422);
  });

  it("rejects a log file outside of the configured log directory hierarchy", async () => {
    const res = await fetch(
      `http://localhost:${port}/logs?file=../../../../../var/log/install.log`
    );
    expect(res.status).toEqual(422);
  });
});
