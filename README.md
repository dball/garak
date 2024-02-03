# Garak

Garak is a plain, simple log tailer.

## Features

Garak provides a web service that allows callers to view the last _n_ entries in a file in `/var/log` that contain one or more keywords.

## Implementation

Garak is written in Typescript, targetting the nodejs runtime It provides package scripts to execute the server via the `ts-node` launcher to keep the build process simple for demonstration purposes.

## Constraints

- This must be reasonably performant when operating on log files of `>1GB`.
- This must use as few dependencies as practical.
- The endpoint must be in the REST style.

## Assumptions

- The log files are append-only.
- The log files contain entries that are strictly terminated by newline characters.
- The log files are text, using a character encoding in which the newline character is unambiguous (ASCII and UTF-8 both qualify).
- The usable memory will be less than the maximum log file size.

## Design Goals

- Demonstrate performant, testable, simple, and fault-tolerant code, in that order.
- Provide a reasonable guarantee the service will not crash, hang, return unknown errors, or incorrectly report a request error as a server error.
