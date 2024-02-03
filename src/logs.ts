import * as fs from "node:fs/promises";

export interface Search {
  readonly path: string;
  readonly total: number;
  readonly pred: (buffer: Buffer) => boolean;
  readonly maxLineLength: number;
  readonly pageLength: number;
}

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
      let offset = 0;
      let length = pageLength;
      let position = lastPosition - pageLength;
      if (position < 0) {
        length += position;
        position = 0;
      }
      console.log("reading page", { offset, length, position });
      // Fully read the page. Since we're reading pages from the end of the file,
      // we can't work with partial results.
      while (offset < length) {
        console.log("reading chunk", { offset, length, position });
        const { bytesRead } = await fd.read({
          buffer: page,
          offset,
          length,
          position,
        });
        if (bytesRead === 0) {
          // https://nodejs.org/api/fs.html#filehandlereadoptions If the file is not
          // modified concurrently, the end-of-file is reached when the number of
          // bytes read is zero. We're reading backwards, so this shouldn't ever
          // happen. If it does, it probably indicates the file was overwritten. By
          // returning here, we're treating that as sort of an event horizon; we
          // generated what we could before the events became unavailable. One could
          // reasonably treat this as a form of filesystem error though.
          return;
        }
        offset += bytesRead;
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
