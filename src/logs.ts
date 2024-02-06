import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface Search {
  readonly file: string;
  readonly total: number;
  readonly pred: (buffer: Buffer) => boolean;

  readonly maxLineLength: number;
  readonly pageLength: number;
  readonly logsDir: string;
}

const readFully = async (
  fd: fs.FileHandle,
  options: fs.FileReadOptions
): Promise<boolean> => {
  let { buffer, offset, length, position } = options;
  while (offset < length) {
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
 * The lines may be slices of the buffer, which is intended to be reused when
 * paging, so must be copied if used outside of the pagination.
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
      lines.push(buffer.subarray(lastNewline + 1, i + 1));
      lastNewline = i;
    }
  }
  if (lastNewline === -1) {
    const overflow = suffix.length + buffer.length >= maxLineLength;
    let prefix: Buffer;
    if (overflow) {
      prefix = Buffer.alloc(0);
    } else {
      prefix = Buffer.allocUnsafe(suffix.length + buffer.length);
      buffer.copy(prefix);
      suffix.copy(prefix, buffer.length);
    }
    return { lines, prefix, overflow };
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

export class LineOverflowError extends Error {
  constructor() {
    super("Line overflow error");
  }
}

export interface LineFinder {
  findLatestLines: () => AsyncGenerator<Buffer>;
}

/**
 * Returns a line finder for the given search, or null if the search is not
 * currently valid on the filesystem, e.g. the file does not exist, or cannot be
 * read.
 *
 * The lineFinder instance *must* be used by calling `findLatestLines` on it
 * once and only once, otherwise this will leak a file descriptor.
 */
// This is perhaps not the most elegant design, but it seems like the only
// practical way to use the async generator function form and also avoid opening
// the file more than once. With only a single internal caller, this seems like
// a defensible choice.
export const buildLineFinder = async (
  search: Search
): Promise<LineFinder | null> => {
  const { file, total, pred, maxLineLength, pageLength, logsDir } = search;
  const absoluteLogsPath = path.resolve(logsDir);
  const absolutelogPath = path.resolve(path.join(absoluteLogsPath, file));
  if (!absolutelogPath.startsWith(absoluteLogsPath)) {
    // TODO Check with prodsec to make sure this is appropriate and sufficient.
    return null;
  }
  try {
    const fd = await fs.open(absolutelogPath, fs.constants.O_RDONLY);
    const stat = await fd.stat();
    const fileLength = stat.size;
    return {
      findLatestLines: async function* () {
        try {
          let lastPosition = fileLength;
          let i = 0;
          let remainder = Buffer.alloc(0);
          const page = Buffer.alloc(pageLength);
          while (lastPosition > 0) {
            let length = pageLength;
            let position = lastPosition - pageLength;
            if (position < 0) {
              length += position;
              position = 0;
            }
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
            const buffer =
              length === pageLength ? page : page.subarray(0, length);
            const { lines, prefix, overflow } = extractLatestLines(
              maxLineLength,
              buffer,
              remainder
            );
            if (overflow) {
              // We check for a maximum line length so that we can provide a
              // reasonable guarantee that we won't run out of memory — our high water
              // heap use is 2-3 times the page size. This seems like a reasonable
              // constraint given the intent and the corpus on which we're likely to
              // operate. Should it become unacceptable, our fallback is probably to
              // model long lines as offsets into the file itself, but then we're
              // susceptible to the file contents changing out from under us.
              //
              // Having found a line that's too long, we could ignore it and move on,
              // but that risks obscuring a weird condition an operator ought to know
              // about. We'll throw here, and figure out what actually to do with the
              // error in the web service layer.
              throw new LineOverflowError();
            }
            for (const line of lines) {
              if (pred(line)) {
                // Copy the line, since we don't have a strong guarantee that the caller
                // will finish using the buffer before the page is recycled.
                yield Buffer.from(line);
                i++;
                if (i === total) {
                  return;
                }
              }
            }
            remainder = prefix;
            lastPosition -= length;
          }
          if (remainder.length !== 0 && pred(remainder)) {
            yield remainder;
          }
        } finally {
          await fd.close();
        }
      },
    };
  } catch (err) {
    return null;
  }
};

// This facilitates repl testing, easier than jest when I'm exploring.
export const test = async () => {
  const results: Array<string> = [];
  const search: Search = {
    logsDir: "tmp",
    file: "large.log",
    pageLength: 2 << 19,
    pred: (buffer) => buffer.toString().includes("1 is even"),
    total: 4,
    maxLineLength: 2 << 15,
  };
  const lineFinder = await buildLineFinder(search);
  for await (const buf of lineFinder.findLatestLines()) {
    results.push(buf.toString());
  }
  return results;
};
