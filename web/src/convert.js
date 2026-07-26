/* Pure port of health_to_garmin_fitbit.py — no DOM, no zip, unit-testable.
 *
 * Aggregates Apple Health interval samples into Garmin-importable "Fitbit"
 * activity CSVs (one per calendar year). Kept byte-for-byte faithful to the
 * validated Python output: same-day fast path, proportional midnight split,
 * mi->km, round-once-per-day with banker's rounding.
 */
import { recordAttrs } from "./parse.js";

export const MI_TO_KM = 1.609344;
export const HEADER =
  "Date,Calories Burned,Steps,Distance,Floors,Minutes Sedentary," +
  "Minutes Lightly Active,Minutes Fairly Active,Minutes Very Active," +
  "Activity Calories";

const TYPE_KEY = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "dist_mi",
  HKQuantityTypeIdentifierFlightsClimbed: "floors",
  HKQuantityTypeIdentifierActiveEnergyBurned: "active_cal",
  HKQuantityTypeIdentifierBasalEnergyBurned: "basal_cal",
};

/** Round half to even (matches Python's round()). Values here are non-negative. */
export function bankersRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1; // exactly .5 -> nearest even
}

/** "YYYY-MM-DD HH:MM:SS ±HHMM" -> pseudo-local epoch seconds (wall-clock as UTC).
 *  A sample's start and end share one offset, so wall-clock differences and
 *  midnight boundaries are exact without real timezone math. */
export function localSeconds(s) {
  const y = +s.slice(0, 4), mo = +s.slice(5, 7), d = +s.slice(8, 10);
  const h = +s.slice(11, 13), mi = +s.slice(14, 16), se = +s.slice(17, 19);
  return Date.UTC(y, mo - 1, d, h, mi, se) / 1000;
}

function dayStr(sec) {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

/** Yield [dayStr, seconds] segments split at local midnight (== Python day_splits). */
export function* daySplits(startSec, endSec) {
  let cur = startSec;
  while (cur < endSec) {
    const d = new Date(cur * 1000);
    const nextMidnight =
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0) / 1000;
    const segEnd = Math.min(endSec, nextMidnight);
    yield [dayStr(cur), segEnd - cur];
    cur = segEnd;
  }
}

/**
 * Consume an (async) iterable of lines; return { days: Map, garminDays: Set }.
 * Accumulates in file order so float sums match the Python reference exactly.
 */
export async function aggregate(lines) {
  const days = new Map(); // dayStr -> { steps, dist_mi, floors, active_cal, basal_cal }
  const garminDays = new Set();

  const bump = (day, key, v) => {
    let o = days.get(day);
    if (!o) days.set(day, (o = {}));
    o[key] = (o[key] || 0) + v;
  };

  for await (const line of lines) {
    const rec = recordAttrs(line);
    if (!rec) continue;
    const key = TYPE_KEY[rec.type];
    if (!key) continue;

    const sd = rec.startDate, ed = rec.endDate;
    const val = parseFloat(rec.value);
    const dS = sd.slice(0, 10);

    if (dS === ed.slice(0, 10)) {
      bump(dS, key, val); // fast path: sample within one local day
    } else {
      const st = localSeconds(sd), en = localSeconds(ed);
      const total = en - st;
      if (total <= 0) {
        bump(dS, key, val);
      } else {
        for (const [day, secs] of daySplits(st, en)) bump(day, key, (val * secs) / total);
      }
    }
    if (rec.sourceName === "Connect") garminDays.add(dS);
  }
  return { days, garminDays };
}

function fmt2(km) {
  // banker's-round to hundredths, then format — avoids toFixed's own rounding
  return (bankersRound(km * 100) / 100).toFixed(2);
}

function rowFor(day, acc) {
  const steps = bankersRound(acc.steps || 0);
  const dist = (acc.dist_mi || 0) * MI_TO_KM;
  const floors = bankersRound(acc.floors || 0);
  const active = bankersRound(acc.active_cal || 0);
  const total = bankersRound((acc.active_cal || 0) + (acc.basal_cal || 0));
  const vals = [day, total, steps, fmt2(dist), floors, 0, 0, 0, 0, active];
  return vals.map((v) => `"${v}"`).join(",");
}

/**
 * Build the yearly CSVs. Returns:
 *   { files: Map<filename, content>, perYear: [{year,days,steps}], skipped: [dayStr] }
 * `content` uses \n line endings + trailing \n (no BOM) — Garmin-safe.
 */
export function buildYearlyCsvs({ days, garminDays }, { includeExisting = false } = {}) {
  const skip = includeExisting ? new Set() : garminDays;
  const byYear = new Map();
  for (const day of [...days.keys()].sort()) {
    if (skip.has(day)) continue;
    const y = day.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(day);
  }

  const files = new Map();
  const perYear = [];
  for (const y of [...byYear.keys()].sort()) {
    const lines = ["Activities", HEADER];
    let ySteps = 0;
    for (const day of byYear.get(y)) {
      const acc = days.get(day);
      lines.push(rowFor(day, acc));
      ySteps += bankersRound(acc.steps || 0);
    }
    files.set(`fitbit_activities_${y}.csv`, lines.join("\n") + "\n");
    perYear.push({ year: y, days: byYear.get(y).length, steps: ySteps });
  }
  return { files, perYear, skipped: [...skip].sort() };
}

/** Small headline summary for the UI. */
export function summarize({ days }) {
  const keys = [...days.keys()].sort();
  let totalSteps = 0;
  for (const o of days.values()) totalSteps += bankersRound(o.steps || 0);
  return {
    totalSteps,
    firstDay: keys[0] || null,
    lastDay: keys[keys.length - 1] || null,
    dayCount: keys.length,
  };
}
