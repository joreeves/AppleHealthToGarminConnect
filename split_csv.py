"""Split a CSV into N chunks of rows.

Keeps the Excel `sep=;` hint (if present) and the header line at the top of
every chunk, so each output file is a valid standalone CSV.

Usage:
    python split_csv.py 10
    python split_csv.py 5 --input HKQuantityTypeIdentifierStepCount.csv --outdir chunks
    python split_csv.py 1000 --by-rows        # 1000 rows per chunk instead of 1000 chunks
"""

import argparse
import math
from pathlib import Path

DEFAULT_INPUT = "HKQuantityTypeIdentifierStepCount.csv"


def main():
    p = argparse.ArgumentParser(description="Split a CSV into N chunks of rows.")
    p.add_argument("n", type=int, help="number of chunks (or rows-per-chunk with --by-rows)")
    p.add_argument("--input", default=DEFAULT_INPUT, help=f"input CSV (default: {DEFAULT_INPUT})")
    p.add_argument("--outdir", default="chunks", help="output directory (default: chunks)")
    p.add_argument("--by-rows", action="store_true", help="treat N as rows-per-chunk")
    args = p.parse_args()

    if args.n < 1:
        p.error("n must be >= 1")

    src = Path(args.input)
    # Read as bytes so original line endings (LF vs CRLF) are preserved exactly
    # and chunks reassemble byte-for-byte identical to the source.
    lines = src.read_bytes().splitlines(keepends=True)

    # Preserve leading `sep=...` hint (if present) plus the header row.
    preamble = []
    if lines and lines[0].lower().startswith(b"sep="):
        preamble.append(lines.pop(0))
    if lines:
        preamble.append(lines.pop(0))  # header
    rows = lines

    if not rows:
        p.error("no data rows found in input")

    rows_per_chunk = args.n if args.by_rows else math.ceil(len(rows) / args.n)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    count = 0
    for i in range(0, len(rows), rows_per_chunk):
        count += 1
        chunk = rows[i : i + rows_per_chunk]
        out = outdir / f"{src.stem}_part{count:03d}{src.suffix}"
        out.write_bytes(b"".join(preamble) + b"".join(chunk))
        print(f"{out}  ({len(chunk)} rows)")

    print(f"\nDone: {len(rows)} rows -> {count} chunk(s) in {outdir}/")


if __name__ == "__main__":
    main()
