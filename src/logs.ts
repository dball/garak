import * as fs from "node:fs/promises";

export interface Search {
  readonly path: string;
  readonly total: number;
  readonly pred: (buffer: Buffer) => boolean;
  readonly maxLineLength: number;
  readonly pageLength: number;
}

const readFully = async (
  fd: fs.FileHandle,
  options: fs.FileReadOptions
): Promise<boolean> => {
  let { buffer, offset, length, position } = options;
  while (offset < length) {
    console.log("reading chunk", { offset, length, position });
    const { bytesRead } = await fd.read({
      buffer,
      offset,
      length,
      position,
    });
    if (bytesRead === 0) {
      // https://nodejs.org/api/fs.html#filehandlereadoptions "If the file is not
      // modified concurrently, the end-of-file is reached when the number of
      // bytes read is zero." We're reading backwards, so this shouldn't ever
      // happen. If it does, it probably indicates the file was overwritten.
      // Regardless, we can't read the full page, so we discard the partial page
      // and return failure.
      return false;
    }
    offset += bytesRead;
  }
  return true;
};

const newline = 0xa;

/**
 * Parse the buffer and suffix looking for newline terminated lines. This
 * returns the known full lines in reverse order, with the first line returned
 * separately as the prefix, since we cannot guarantee it is complete.
 *
 * If the suffix ends with a newline, it is taken to be the termination of the
 * last partial line in the buffer. If it does not end with a new line, it and
 * any remainder from the buffer are discarded.
 *
 * If there are no newlines in the buffer, it is prepended to the suffix and
 * returned as the prefix.
 *
 * All lines, including the prefix, are copied from the buffer, which is assumed
 * to be reused for performance. By contrast, the suffix is assumed to be
 * transient and may be used without copying.
 */
export const extractLatestLines = (
  maxLineLength: number,
  buffer: Buffer,
  suffix: Buffer
): { lines: Array<Buffer>; prefix: Buffer; overflow: boolean } => {
  const lines: Array<Buffer> = [];
  let lastNewline = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer.at(i) === newline) {
      const line = Buffer.allocUnsafe(i - lastNewline);
      buffer.copy(line, 0, lastNewline + 1, i + 1);
      lines.push(line);
      lastNewline = i;
    }
  }
  if (lastNewline === -1) {
    const prefix = Buffer.allocUnsafe(suffix.length + buffer.length);
    buffer.copy(prefix);
    suffix.copy(prefix, buffer.length);
    // TODO skip the allocation if overflow
    return {
      lines,
      prefix,
      overflow: suffix.length + buffer.length >= maxLineLength,
    };
  }
  // If the suffix ends with a newline, we prefix any remainder and append it to the lines
  // If the suffix does not end with a newline, we discard it and any remainder
  if (lastNewline !== buffer.length - 1) {
    if (suffix.length !== 0 && suffix.at(suffix.length - 1) === newline) {
      const line = Buffer.allocUnsafe(
        buffer.length - (lastNewline + 1) + suffix.length
      );
      buffer.copy(line, 0, lastNewline + 1);
      suffix.copy(line, buffer.length - (lastNewline + 1));
      lines.push(line);
    }
  } else {
    if (suffix.length !== 0 && suffix.at(suffix.length - 1) === newline) {
      // If there is a newline terminated suffix, it's a legit line
      lines.push(suffix);
    }
  }
  lines.reverse();
  const prefix = lines.pop();
  return {
    lines,
    prefix,
    overflow: !lines.every((line) => line.length <= maxLineLength),
  };
};

export async function* findLatestLines(search: Search): AsyncGenerator<Buffer> {
  const { path, total, pred, maxLineLength, pageLength } = search;
  const fd = await fs.open(path, fs.constants.O_RDONLY);
  try {
    const stat = await fd.stat();
    const fileLength = stat.size;
    console.log("reading file", { path, fileLength, pageLength });
    let lastPosition = fileLength;
    let i = 0;
    let remainder = Buffer.alloc(0);
    const page = Buffer.alloc(pageLength);
    while (i < total && lastPosition > 0) {
      let length = pageLength;
      let position = lastPosition - pageLength;
      if (position < 0) {
        length += position;
        position = 0;
      }
      console.log("reading page", { length, position });
      const fullyRead = await readFully(fd, {
        buffer: page,
        offset: 0,
        length,
        position,
      });
      if (!fullyRead) {
        // If we hit the end of the file unexpectedly, we could reasonably just
        // keep whatever we've generated thus far, or error out. The former
        // seems both logically defensible and user-friendly.
        return;
      }
      // We just yield the pages for now to see how buggy this junk is.
      const result = Buffer.alloc(length);
      page.copy(result);
      yield result;
      lastPosition -= length;
      i++;
    }
  } finally {
    await fd.close();
  }
}

export const test = async () => {
  const results: Array<string> = [];
  const search: Search = {
    path: "tmp/large.log",
    pageLength: 4096,
    pred: () => true,
    total: 4,
    maxLineLength: 0,
  };
  console.log("testing");
  for await (const buf of findLatestLines(search)) {
    results.push(buf.toString());
  }
  return results;
};
