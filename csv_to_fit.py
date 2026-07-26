"""Convert an Apple Health step-count CSV into Garmin-compatible FIT monitoring files.

Apple Health exports step data as many short interval samples. Garmin Connect's
"Import Data" page only accepts FIT/TCX/GPX -- never CSV -- and daily steps live
in the FIT *monitoring* message type. This tool groups the interval samples by
local day and writes one monitoring FIT file per day, with a running (cumulative)
step count, which is how Garmin records all-day step tracking.

NOTE: Garmin Connect's web import is built for *activities*; importing daily
monitoring data this way is not officially supported and may be rejected. Test a
single day first (default behavior) before converting everything.

Usage:
    python csv_to_fit.py --date 2026-06-24          # one day -> fit_out/
    python csv_to_fit.py --latest                    # most recent full day
    python csv_to_fit.py --all --outdir fit_out      # every day, one file each
"""

import argparse
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from fit_tool.fit_file_builder import FitFileBuilder
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.monitoring_info_message import MonitoringInfoMessage
from fit_tool.profile.messages.monitoring_message import MonitoringMessage
from fit_tool.profile.profile_type import ActivityType, FileType, Manufacturer

DEFAULT_INPUT = "HKQuantityTypeIdentifierStepCount.csv"
FMT = "%Y-%m-%d %H:%M:%S %z"
FIT_EPOCH = 631065600  # Unix seconds at 1989-12-31 00:00:00 UTC (FIT date_time base)


def ms(dt: datetime) -> int:
    """Milliseconds since the Unix epoch (what fit_tool expects for timestamps)."""
    return round(dt.timestamp() * 1000)


def load_by_day(path: Path):
    """Return {local_date_str: [(end_dt, steps), ...]} sorted by end time."""
    days = defaultdict(list)
    with open(path, encoding="utf-8") as f:
        first = f.readline()
        if not first.lower().startswith("sep="):
            f.seek(0)  # no Excel hint; rewind so header isn't skipped
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            start = datetime.strptime(row["startdate"], FMT)
            end = datetime.strptime(row["enddate"], FMT)
            local_day = row["startdate"][:10]  # already local (offset baked in)
            days[local_day].append((start, end, int(row["value"])))
    for d in days.values():
        d.sort(key=lambda t: t[1])  # by end time
    return days


def build_day_fit(local_day: str, samples) -> bytes:
    """Build one monitoring FIT file (bytes) for a single local day."""
    builder = FitFileBuilder(auto_define=True)

    day_start = samples[0][0]                 # first start (tz-aware, local offset)
    offset_s = day_start.utcoffset().total_seconds()

    file_id = FileIdMessage()
    file_id.type = FileType.MONITORING_B
    file_id.manufacturer = Manufacturer.GARMIN.value
    file_id.product = 0
    file_id.serial_number = 1
    file_id.time_created = ms(day_start)
    builder.add(file_id)

    info = MonitoringInfoMessage()
    info.timestamp = ms(day_start)
    # local_timestamp is a raw uint32 of FIT-epoch *seconds*, shifted by the
    # local UTC offset (NOT ms-since-Unix like the special `timestamp` field).
    info.local_timestamp = int(day_start.timestamp()) - FIT_EPOCH + int(offset_s)
    info.activity_type = [ActivityType.WALKING.value]
    builder.add(info)

    cumulative = 0
    for _start, end, steps in samples:
        cumulative += steps
        m = MonitoringMessage()
        m.timestamp = ms(end)
        m.activity_type = ActivityType.WALKING.value
        m.steps = cumulative
        builder.add(m)

    return builder.build().to_bytes()


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", default=DEFAULT_INPUT)
    p.add_argument("--outdir", default="fit_out")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--date", help="single local day YYYY-MM-DD")
    g.add_argument("--latest", action="store_true", help="most recent full day")
    g.add_argument("--all", action="store_true", help="every day, one file each")
    args = p.parse_args()

    days = load_by_day(Path(args.input))
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.date:
        targets = [args.date]
    elif args.latest:
        targets = [max(days)]
    else:
        targets = sorted(days)

    for day in targets:
        if day not in days:
            p.error(f"no data for {day}")
        data = build_day_fit(day, days[day])
        out = outdir / f"steps_{day}.fit"
        out.write_bytes(data)
        total = sum(s for *_ , s in days[day])
        print(f"{out}  ({len(days[day])} samples, {total} steps, {len(data)} bytes)")

    print(f"\nDone: {len(targets)} file(s) in {outdir}/")


if __name__ == "__main__":
    main()
