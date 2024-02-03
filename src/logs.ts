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
