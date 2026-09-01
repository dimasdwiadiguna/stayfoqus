import {
  CalculationMethod,
  CalculationParameters,
  Coordinates,
  PrayerTimes,
} from "adhan";

import type {
  IsoDate,
  PrayerBlockSettings,
  PrayerCalculationMethod,
  PrayerKey,
} from "@/lib/db/schema";
import { dateRange, isFriday } from "@/lib/time";
import { byStart } from "@/lib/scheduling/intervals";
import type { PrayerBlock } from "@/lib/scheduling/types";

/**
 * §5.3 — prayer blocks, computed offline from stored coordinates.
 *
 * Never written to Google Calendar; treated as busy by the scheduler; five
 * daily blocks with individually adjustable durations, and a longer Friday
 * Dhuhr.
 */

const PRAYER_KEYS: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/**
 * `adhan` ships no Kemenag preset, so the Indonesian Ministry of Religious
 * Affairs parameters are expressed explicitly: Fajr 20°, Isha 18°, plus the
 * 2-minute *ihtiyati* (safety margin) Kemenag applies to its published tables.
 * Without the ihtiyati the computed times run a minute or two ahead of the
 * schedules the user actually sees, which for a scheduling app means blocks
 * that start slightly too late.
 */
function kemenagParameters(): CalculationParameters {
  const params = new CalculationParameters("Other", 20, 18);
  params.methodAdjustments = {
    fajr: 2,
    sunrise: -2,
    dhuhr: 2,
    asr: 2,
    maghrib: 2,
    isha: 2,
  };
  return params;
}

export function calculationParametersFor(
  method: PrayerCalculationMethod,
): CalculationParameters {
  switch (method) {
    case "Kemenag":
      return kemenagParameters();
    case "MuslimWorldLeague":
      return CalculationMethod.MuslimWorldLeague();
    case "Egyptian":
      return CalculationMethod.Egyptian();
    case "Karachi":
      return CalculationMethod.Karachi();
    case "UmmAlQura":
      return CalculationMethod.UmmAlQura();
    case "Singapore":
      return CalculationMethod.Singapore();
  }
}

/**
 * `adhan` reads the civil date off the *runtime's local* calendar fields
 * (`getFullYear`/`getMonth`/`getDate`) and returns UTC instants. Passing an
 * instant built from the user's timezone would therefore be read back in the
 * server's timezone and could land on the wrong day.
 *
 * Building the Date through the local constructor at midday makes those three
 * fields exactly the target civil date on any host, which is what adhan needs.
 * The instants it returns are absolute, so nothing downstream is affected.
 */
function civilDate(date: IsoDate): Date {
  const [y = "1970", m = "01", d = "01"] = date.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
}

export interface PrayerTimesForDay {
  date: IsoDate;
  times: Record<PrayerKey, Date>;
}

export function prayerTimesFor(
  date: IsoDate,
  latitude: number,
  longitude: number,
  method: PrayerCalculationMethod,
): PrayerTimesForDay {
  const times = new PrayerTimes(
    new Coordinates(latitude, longitude),
    civilDate(date),
    calculationParametersFor(method),
  );
  return {
    date,
    times: {
      fajr: times.fajr,
      dhuhr: times.dhuhr,
      asr: times.asr,
      maghrib: times.maghrib,
      isha: times.isha,
    },
  };
}

export interface PrayerBlockConfig {
  latitude: number;
  longitude: number;
  method: PrayerCalculationMethod;
  blocks: PrayerBlockSettings;
  fridayDhuhrDurationMin: number;
}

/**
 * Resolves prayer blocks for a date range.
 *
 * §5.3 has each block "starting at the prayer time". Requested change (D-102):
 * the block is **centred** on the adhan instead, so its first half is time to
 * stop working, walk and make wudhu — a block that begins at the call to prayer
 * reserves no time to answer it.
 *
 * `duration_min` still means the *whole* block, so nothing about the day's
 * capacity moves: 20 minutes is 20 minutes, now 10 either side. Friday Dhuhr
 * follows the same rule with `friday_dhuhr_duration_min`.
 */
export function resolvePrayerBlocks(
  config: PrayerBlockConfig,
  from: IsoDate,
  to: IsoDate,
): PrayerBlock[] {
  const out: PrayerBlock[] = [];

  for (const date of dateRange(from, to)) {
    const { times } = prayerTimesFor(
      date,
      config.latitude,
      config.longitude,
      config.method,
    );
    const friday = isFriday(date);

    for (const key of PRAYER_KEYS) {
      const setting = config.blocks[key];
      if (!setting.enabled) continue;

      const fridayDhuhr = friday && key === "dhuhr";
      const durationMin = fridayDhuhr
        ? config.fridayDhuhrDurationMin
        : setting.duration_min;
      if (durationMin <= 0) continue;

      // Halved in milliseconds rather than minutes, so an odd duration (25)
      // splits exactly and `end - start` is always the configured length.
      const adhan = times[key].getTime();
      const durationMs = durationMin * 60_000;
      const start = adhan - durationMs / 2;

      out.push({
        date,
        key,
        fridayDhuhr,
        adhan,
        start,
        end: start + durationMs,
      });
    }
  }

  return out.sort(byStart);
}
