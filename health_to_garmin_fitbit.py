"""Convert Apple Health export.xml into Garmin-importable "Fitbit" activity CSVs.

Garmin Connect's "Import Fitbit Data" feature accepts the *native Fitbit export*
CSV layout (verified against armixlabs/FitbitToGarminConverter and a working
gist), which is NOT the MyDataHelps export format:

    line 1:  Activities
    line 2:  Date,Calories Burned,Steps,Distance,Floors,Minutes Sedentary,...
    rows  :  "2025-01-15","2818","8624","5.19","0","0","0","0","0","187"

Rules that make Garmin reject a file (from Garmin's support text):
  * dates must be uniform YYYY-MM-DD (no time component)
  * import <= 1 year of data at a time  -> we write one file per calendar year
  * a day Garmin already has its own data for collides -> we drop Garmin-sourced
    days (the `Connect` source in the Apple export) by default
  * don't open the output in Excel (it rewrites/breaks the format)

Apple Health -> Fitbit activities mapping:
    StepCount                    -> Steps
    DistanceWalkingRunning (mi)  -> Distance        [mi -> km, 2dp]
    FlightsClimbed               -> Floors
    ActiveEnergyBurned (kcal)    -> Activity Calories
    Active + Basal energy (kcal) -> Calories Burned
    (Apple has no Fitbit-style active-minute buckets -> written as 0)

Usage:
    python health_to_garmin_fitbit.py
    python health_to_garmin_fitbit.py --outdir garmin_import --include-existing
"""

import argparse
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, time, timedelta
from pathlib import Path

MI_TO_KM = 1.609344
FMT = "%Y-%m-%d %H:%M:%S %z"
HEADER = ("Date,Calories Burned,Steps,Distance,Floors,Minutes Sedentary,"
          "Minutes Lightly Active,Minutes Fairly Active,Minutes Very Active,"
          "Activity Calories")

TYPE_KEY = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "dist_mi",
    "HKQuantityTypeIdentifierFlightsClimbed": "floors",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_cal",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "basal_cal",
}


def day_splits(start: datetime, end: datetime):
    """Yield (local_date_str, seconds_in_that_day) for a sample, splitting it at
    local midnight exactly as Apple Health attributes boundary-crossing samples."""
    cur = start
    while cur < end:
        next_midnight = datetime.combine(
            (cur + timedelta(days=1)).date(), time.min, tzinfo=cur.tzinfo)
        seg_end = min(end, next_midnight)
        yield cur.strftime("%Y-%m-%d"), (seg_end - cur).total_seconds()
        cur = seg_end


def aggregate(xml_path: Path):
    """Sum each metric per local day; track days Garmin already owns.

    Samples wholly within one local day (the vast majority) are added directly.
    Samples that cross local midnight are split proportionally by time across the
    days they touch, matching how the Health app reports daily totals. Fractions
    accumulate as floats and are only rounded once, per day, when rows are built.
    """
    days = defaultdict(lambda: defaultdict(float))
    garmin_days = set()
    for _ev, el in ET.iterparse(str(xml_path), events=("end",)):
        if el.tag == "Record":
            a = el.attrib
            key = TYPE_KEY.get(a.get("type"))
            if key:
                sd, ed = a["startDate"], a["endDate"]
                val = float(a["value"])
                if sd[:10] == ed[:10]:                 # fast path: same local day
                    days[sd[:10]][key] += val
                else:                                  # crosses midnight -> split
                    start, end = datetime.strptime(sd, FMT), datetime.strptime(ed, FMT)
                    total = (end - start).total_seconds()
                    if total <= 0:
                        days[sd[:10]][key] += val
                    else:
                        for day, secs in day_splits(start, end):
                            days[day][key] += val * secs / total
                if a.get("sourceName") == "Connect":
                    garmin_days.add(sd[:10])
        el.clear()
    return days, garmin_days


def row(day: str, acc: dict) -> str:
    steps = int(round(acc.get("steps", 0)))
    dist = acc.get("dist_mi", 0.0) * MI_TO_KM
    floors = int(round(acc.get("floors", 0)))
    active = int(round(acc.get("active_cal", 0)))
    total = int(round(acc.get("active_cal", 0) + acc.get("basal_cal", 0)))
    vals = [day, total, steps, f"{dist:.2f}", floors, 0, 0, 0, 0, active]
    return ",".join(f'"{v}"' for v in vals)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", default="export.xml")
    p.add_argument("--outdir", default="garmin_import")
    p.add_argument("--include-existing", action="store_true",
                   help="keep days Garmin already has data for (default: drop them)")
    args = p.parse_args()

    days, garmin_days = aggregate(Path(args.input))

    skip = set() if args.include_existing else garmin_days
    by_year = defaultdict(list)
    for day in sorted(days):
        if day in skip:
            continue
        by_year[day[:4]].append(day)

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    for year in sorted(by_year):
        lines = ["Activities", HEADER]
        lines += [row(d, days[d]) for d in by_year[year]]
        out = outdir / f"fitbit_activities_{year}.csv"
        # write with \n, no BOM, never via Excel -> Garmin-safe
        out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        steps = sum(int(round(days[d].get("steps", 0))) for d in by_year[year])
        print(f"{out}  ({len(by_year[year])} days, {steps:,} steps)")

    if skip:
        print(f"\nSkipped {len(skip)} day(s) Garmin already has: {sorted(skip)}")
        print("  (use --include-existing to keep them)")
    print(f"\nDone: {sum(len(v) for v in by_year.values())} days across "
          f"{len(by_year)} yearly file(s) in {outdir}/")


if __name__ == "__main__":
    main()
