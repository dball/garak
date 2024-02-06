# Garak

Garak is a plain, simple log tailer.

## Features

Garak provides a web service that allows callers to view the last _n_ entries in a file within `/var/log`, possibly constrained by the presence of one or more keywords.

## Implementation

Garak is written in Typescript, targeting the nodejs runtime. It provides package scripts to execute the server via the `ts-node` launcher to keep the build process simple for demonstration purposes.

## API

The service provides a single path, `/logs`, which accepts `GET` requests with the following query parameters:

- `file` — required, the path to the file under the logs directory, e.g. `messages` or `install.log`
- `total`— required, the number of lines to return
- `keywords` — optional, a string which must appear in a matching line. This may appear multiple times.

For example:

`http://localhost:8000/logs?file=system.log&total=2&keywords=syslogd&keywords=Feb`

Successful responses will have status 200 with a content-type of
`application/octet-stream`, the body of which contains the matching lines
ordered from most to least recent. If the service encounters a filesystem error
while reading the logs, the response will end with `Premature end of stream`.

Invalid responses will have status 422. Invalid conditions include missing or
unreadable files or paths to files outside of the logs directory.

## Usage

On a system with node `20.9.0` or compatible in the environment:

1. `npm install`
2. `npm run server`

The server runs in the foreground, and may be stopped cleanly an INT or TERM signal, typically by hitting `CTRL-C`.

The server accepts runtime configuration flags:

```
Usage:
[--port <value>]
[--logsDir <value>]
[--pageLength <value>]
[--maxLineLength <value>]
```

By default, it listens on port 8000, serves entries from within `/var/log`, uses a page length of 1M, and assumes a maximum line length of 65536 bytes. The npm launcher requires a `--` separator to distinguish its args from the server args, e.g.:

`npm run server -- --logsDir ./tmp`

Garak emits logs of its own activity to stdout.

## Test

On a system with node `20.9.0` or compatible in the environment:

1. `npm ci`
2. `npm run test`

The test suite contains both unit and integration tests. All of the tests are
pure, though the latter creates a `tmp` folder in the root of the repo in which
it creates a large log file of 1.5G on its first run. On a 2023 Macbook Pro,
this takes about 90 seconds. It also binds to a random free tcp port on
localhost to exercise the service over http.

## Constraints

- This must be reasonably performant when operating on log files of `>1GB`.
- This must use as few dependencies as practical.
- The endpoint must be in the REST style.

## Assumptions

- The log files are append-only.
- The log files contain entries that are strictly terminated by newline characters.
- The log files are text, using a character encoding in which the newline character is unambiguous (ASCII and UTF-8 both qualify).
- The usable memory will be less than the maximum log file size.
- It is acceptable to enforce a maximum line length (e.g. to guard against memory overflow trying to process a large binary file).

## Design Goals

- Demonstrate performant, testable, simple, and fault-tolerant code, in that order.
- Provide a reasonable guarantee the service will not crash, hang, return unknown errors, or incorrectly report a request error as a server error.

## Future Work

The customer has expressed interest in distributed searches, in which a primary
fans out to a set of secondaries and returns the aggregate responses. It would
be straightforward to add a runtime configuration to the primary with the set of
its secondaries if they are static, or even to resolve them at request time from
a service registry. The essential difficulty with reconciling Garak to the
federation is revising the log message format so that lines can be attributed to
their servers correctly.

I chose not to introduce any message format in the first version, for speed,
simplicity, and to make using `curl` directly comparable to using `tail` on a
local file. If server attribution is important, we could perhaps get away with
simply printing the server identity as a prefix on each line, but it seems wiser
to design a message protocol, which would afford us a place to unambiguously
indicate error conditions (e.g. truncated file, file changing permission, or
file line length exceeds limits).

Other considerations include:

- Would we want recursive distribution, and if so, how would we prohibit cycles
  in the graph?
- Do we need to enforce timeouts on our requests? What if one of our secondaries
  is extremely slow?
- If a secondary fails while we're processing a search, do we choose to retry?
  If so, can the client receive duplicates, or do we need to consider
  introducing cursors?
