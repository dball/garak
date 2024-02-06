import * as logs from "./logs";

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
