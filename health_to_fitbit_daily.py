"""Convert an Apple Health export.xml into the Fitbit Daily Data export CSV format.

Target spec: https://support.mydatahelps.org/fitbit-daily-data-export-format
One row per local day, ISO-8601 dates, the documented column set.

Apple Health -> Fitbit field mapping (only unambiguous mappings are filled;
everything else is left blank so the importer sees the full, valid header):

    StepCount (count)            -> Steps, TrackerSteps
    DistanceWalkingRunning (mi)  -> Distance, TrackerDistance      [mi -> km]
    FlightsClimbed (count)       -> Floors, TrackerFloors
    ActiveEnergyBurned (kcal)    -> ActivityCalories, TrackerActivityCalories
    BasalEnergyBurned (kcal)     -> CaloriesBMR
    Active + Basal               -> Calories, TrackerCalories

Steps/distance are summed across all source devices; the phones in this export
were used in non-overlapping periods, so summation matches the daily totals.

Usage:
    python health_to_fitbit_daily.py
    python health_to_fitbit_daily.py --participant JOSIAH --out fitbit_daily.csv
"""

import argparse
import csv
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

MI_TO_KM = 1.609344

# Full Fitbit Daily Data export header, verbatim from the spec.
COLUMNS = [
    "ParticipantIdentifier", "Date", "ActivityCalories", "BodyBmi", "BodyFat",
    "BodyFatLog", "BodyFatLogSource", "BodyWeight", "BodyWeightLogBodyWeight",
    "BodyWeightLogBMI", "BodyWeightLogFat", "BodyWeightLogSource", "Calories",
    "CaloriesBMR", "Distance", "Elevation", "Floors", "FoodCaloriesIn",
    "HeartRateIntradayCount", "HeartRateZoneOutOfRangeCaloriesOut",
    "HeartRateZoneOutOfRangeMax", "HeartRateZoneOutOfRangeMin",
    "HeartRateZoneOutOfRangeMinutes", "HeartRateZoneFatBurnCaloriesOut",
    "HeartRateZoneFatBurnMax", "HeartRateZoneFatBurnMin",
    "HeartRateZoneFatBurnMinutes", "HeartRateZoneCardioCaloriesOut",
    "HeartRateZoneCardioMax", "HeartRateZoneCardioMin",
    "HeartRateZoneCardioMinutes", "HeartRateZonePeakCaloriesOut",
    "HeartRateZonePeakMax", "HeartRateZonePeakMin", "HeartRateZonePeakMinutes",
    "MinutesFairlyActive", "MinutesLightlyActive", "MinutesSedentary",
    "MinutesVeryActive", "RestingHeartRate", "Steps", "TrackerActivityCalories",
    "TrackerCalories", "TrackerDistance", "TrackerElevation", "TrackerFloors",
    "TrackerMinutesFairlyActive", "TrackerMinutesLightlyActive",
    "TrackerMinutesSedentary", "TrackerMinutesVeryActive", "TrackerSteps",
    "Water", "ModifiedDate", "HeartRateIntradayMinuteCount", "BreathingRate",
    "HrvDailyRmssd", "HrvDeepRmssd", "SpO2Avg", "SpO2Min", "SpO2Max",
    "CardioScore", "TempCore", "TempSkin", "TempSkinLogType",
]

# HealthKit type -> accumulator key
TYPE_KEY = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "dist_mi",
    "HKQuantityTypeIdentifierFlightsClimbed": "floors",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_cal",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "basal_cal",
}


def aggregate(xml_path: Path):
    """Stream the export and sum each tracked metric per local day."""
    days = defaultdict(lambda: defaultdict(float))
    for _ev, el in ET.iterparse(str(xml_path), events=("end",)):
        if el.tag == "Record":
            key = TYPE_KEY.get(el.attrib.get("type"))
            if key:
                day = el.attrib["startDate"][:10]  # local date (offset baked in)
                days[day][key] += float(el.attrib["value"])
        el.clear()
    return days


def row_for(day: str, acc: dict, participant: str) -> dict:
    r = {c: "" for c in COLUMNS}
    r["ParticipantIdentifier"] = participant
    r["Date"] = f"{day}T00:00:00"

    if "steps" in acc:
        steps = int(round(acc["steps"]))
        r["Steps"] = r["TrackerSteps"] = steps
    if "dist_mi" in acc:
        km = round(acc["dist_mi"] * MI_TO_KM, 2)
        r["Distance"] = r["TrackerDistance"] = km
    if "floors" in acc:
        floors = int(round(acc["floors"]))
        r["Floors"] = r["TrackerFloors"] = floors
    if "active_cal" in acc:
        active = int(round(acc["active_cal"]))
        r["ActivityCalories"] = r["TrackerActivityCalories"] = active
    if "basal_cal" in acc:
        r["CaloriesBMR"] = int(round(acc["basal_cal"]))
    if "active_cal" in acc or "basal_cal" in acc:
        total = int(round(acc.get("active_cal", 0) + acc.get("basal_cal", 0)))
        r["Calories"] = r["TrackerCalories"] = total
    return r


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--input", default="export.xml")
    p.add_argument("--out", default="fitbit_daily.csv")
    p.add_argument("--participant", default="", help="ParticipantIdentifier for every row")
    args = p.parse_args()

    days = aggregate(Path(args.input))

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for day in sorted(days):
            w.writerow(row_for(day, days[day], args.participant))

    total_steps = int(sum(d.get("steps", 0) for d in days.values()))
    print(f"Wrote {args.out}: {len(days)} days "
          f"({min(days)} -> {max(days)}), {total_steps:,} total steps")


if __name__ == "__main__":
    main()
