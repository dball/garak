import * as fs from "node:fs/promises";
import * as path from "node:path";

export const largeLogPath = path.resolve(__dirname, "..", "tmp", "large.log");

/**
 * This overwrites the contents of the largeLogPath file with
 * over a gigabyte of synthetic, pure log lines, suitable for
 * use by tests.
 *
 * It will throw on any filesystem error.
 */
export const main = async () => {
  const fd = await fs.open(
    largeLogPath,
    fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY,
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

if (require.main === module) {
  main();
}
