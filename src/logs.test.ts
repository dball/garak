import * as logs from "./logs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const largeLogPath = path.resolve(__dirname, "..", "tmp", "large.log");

/**
 * This overwrites the contents of the largeLogPath file with
 * over a gigabyte of synthetic, pure log lines, suitable for
 * use by tests.
 *
 * It will throw on any filesystem error.
 */
// A useful stress test: curl 'http://localhost:8000/logs?file=large.log&total=10&keywords=odd&keywords=9111111'
export const writeTestFile = async () => {
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

describe("extractLatestLines", () => {
  it("handles precisely one line", () => {
    const result = logs.extractLatestLines(
      4,
      Buffer.from("one\n"),
      Buffer.alloc(0)
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([]);
    expect(result.prefix.toString()).toEqual("one\n");
  });

  it("handles precisely one empty line", () => {
    const result = logs.extractLatestLines(
      4,
      Buffer.from("\n"),
      Buffer.alloc(0)
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([]);
    expect(result.prefix.toString()).toEqual("\n");
  });

  it("handles several nicely aligned lines", () => {
    const result = logs.extractLatestLines(
      8,
      Buffer.from("one\ntwo\nthree\nfour\n"),
      Buffer.alloc(0)
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([
      "four\n",
      "three\n",
      "two\n",
    ]);
    expect(result.prefix.toString()).toEqual("one\n");
  });

  it("handles several lines and a newline suffix", () => {
    const result = logs.extractLatestLines(
      8,
      Buffer.from("one\ntwo\nthree\nfour\nfi"),
      Buffer.from("ve\n")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([
      "five\n",
      "four\n",
      "three\n",
      "two\n",
    ]);
    expect(result.prefix.toString()).toEqual("one\n");
  });

  it("handles no lines and a newline suffix", () => {
    const result = logs.extractLatestLines(
      32,
      Buffer.from("onetwothreefourfi"),
      Buffer.from("ve\n")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([]);
    expect(result.prefix.toString()).toEqual("onetwothreefourfive\n");
  });

  it("handles an empty line and a newline suffix", () => {
    const result = logs.extractLatestLines(
      32,
      Buffer.from("\n"),
      Buffer.from("five\n")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual(["five\n"]);
    expect(result.prefix.toString()).toEqual("\n");
  });

  it("handles an empty line and a garbage suffix", () => {
    const result = logs.extractLatestLines(
      32,
      Buffer.from("\n"),
      Buffer.from("five")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([]);
    expect(result.prefix.toString()).toEqual("\n");
  });

  it("handles several lines and a garbage suffix", () => {
    const result = logs.extractLatestLines(
      32,
      Buffer.from("one\ntwo\nthree\nfour\n"),
      Buffer.from("five")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual([
      "four\n",
      "three\n",
      "two\n",
    ]);
    expect(result.prefix.toString()).toEqual("one\n");
  });

  it("handles several lines plus some garbage and a garbage suffix", () => {
    const result = logs.extractLatestLines(
      32,
      Buffer.from("one\ntwo\nthree\nfour"),
      Buffer.from("five")
    );
    expect(result.overflow).toEqual(false);
    expect(result.lines.map((l) => l.toString())).toEqual(["three\n", "two\n"]);
    expect(result.prefix.toString()).toEqual("one\n");
  });
});
