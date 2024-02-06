# Garak

Garak is a plain, simple log tailer.

## Features

Garak provides a web service that allows callers to view the last _n_ entries in a file within `/var/log`, possibly constrained by the presence of one or more keywords.

## Implementation

Garak is written in Typescript, targeting the nodejs runtime. It provides package scripts to execute the server via the `ts-node` launcher to keep the build process simple for demonstration purposes.

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

By default, it listens on port 8000, serves entries from within `/var/log`, uses a page length of 1M, and assumes a maximum line length of 65536 bytes. The npm launcher requires a `--` separator to distinguish its args from the server args:

`npm run server -- --logsDir ./tmp`

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
