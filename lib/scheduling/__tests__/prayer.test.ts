import { describe, expect, it } from "vitest";

import { prayerTimesFor, resolvePrayerBlocks } from "@/lib/scheduling/prayer";
import { localTime } from "@/lib/time";

import { JKT } from "./helpers";

// Bandung — the seeded default coordinates (§4.8).
const LAT = -6.9175;
const LNG = 107.6191;

const blocks = (durationMin = 20) => ({
  fajr: { enabled: true, duration_min: durationMin },
  dhuhr: { enabled: true, duration_min: durationMin },
  asr: { enabled: true, duration_min: durationMin },
  maghrib: { enabled: true, duration_min: durationMin },
  isha: { enabled: true, duration_min: durationMin },
});

describe("§5.3 prayer times", () => {
  it("computes plausible Bandung times with the Kemenag parameters", () => {
    const { times } = prayerTimesFor("2026-08-26", LAT, LNG, "Kemenag");
    const local = {
      fajr: localTime(times.fajr, JKT),
      dhuhr: localTime(times.dhuhr, JKT),
      asr: localTime(times.asr, JKT),
      maghrib: localTime(times.maghrib, JKT),
      isha: localTime(times.isha, JKT),
    };

    // Bandung sits near the equator, so the spread barely moves across the
    // year. These bounds are wide enough to be robust and tight enough to
    // catch a wrong day, a wrong timezone, or a wrong parameter set.
    expect(local.fajr >= "04:15" && local.fajr <= "05:00").toBe(true);
    expect(local.dhuhr >= "11:40" && local.dhuhr <= "12:15").toBe(true);
    expect(local.asr >= "14:50" && local.asr <= "15:40").toBe(true);
    expect(local.maghrib >= "17:30" && local.maghrib <= "18:20").toBe(true);
    expect(local.isha >= "18:40" && local.isha <= "19:30").toBe(true);
  });

  it("keeps the prayers in ascending order", () => {
    const { times } = prayerTimesFor("2026-08-26", LAT, LNG, "Kemenag");
    const order = [times.fajr, times.dhuhr, times.asr, times.maghrib, times.isha];
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i]!.getTime()).toBeGreaterThan(order[i - 1]!.getTime());
    }
  });

  it("does not depend on the host timezone", () => {
    // adhan reads the civil date off the runtime's local fields; the module
    // builds that Date through the local constructor so the day is stable.
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = prayerTimesFor("2026-08-26", LAT, LNG, "Kemenag");
      expect(localTime(utc.times.dhuhr, JKT) >= "11:40").toBe(true);
      expect(localTime(utc.times.dhuhr, JKT) <= "12:15").toBe(true);
    } finally {
      process.env.TZ = original;
    }
  });

  it("differs between calculation methods", () => {
    const kemenag = prayerTimesFor("2026-08-26", LAT, LNG, "Kemenag");
    const mwl = prayerTimesFor("2026-08-26", LAT, LNG, "MuslimWorldLeague");
    expect(kemenag.times.fajr.getTime()).not.toBe(mwl.times.fajr.getTime());
  });
});

describe("§5.3 prayer blocks", () => {
  const config = {
    latitude: LAT,
    longitude: LNG,
    method: "Kemenag" as const,
    blocks: blocks(),
    fridayDhuhrDurationMin: 90,
  };

  it("produces five blocks per day, each 20 minutes by default", () => {
    const result = resolvePrayerBlocks(config, "2026-08-26", "2026-08-26");
    expect(result).toHaveLength(5);
    for (const block of result) {
      expect((block.end - block.start) / 60_000).toBe(20);
    }
  });

  it("starts each block at the prayer time", () => {
    const { times } = prayerTimesFor("2026-08-26", LAT, LNG, "Kemenag");
    const result = resolvePrayerBlocks(config, "2026-08-26", "2026-08-26");
    const fajr = result.find((b) => b.key === "fajr")!;
    expect(fajr.start).toBe(times.fajr.getTime());
  });

  it("gives Friday Dhuhr the longer duration", () => {
    // 2026-08-28 is a Friday.
    const friday = resolvePrayerBlocks(config, "2026-08-28", "2026-08-28");
    const dhuhr = friday.find((b) => b.key === "dhuhr")!;
    expect(dhuhr.fridayDhuhr).toBe(true);
    expect((dhuhr.end - dhuhr.start) / 60_000).toBe(90);

    // Every other prayer that day keeps its own duration.
    const asr = friday.find((b) => b.key === "asr")!;
    expect((asr.end - asr.start) / 60_000).toBe(20);

    // And Thursday's Dhuhr is unaffected.
    const thursday = resolvePrayerBlocks(config, "2026-08-27", "2026-08-27");
    const thursdayDhuhr = thursday.find((b) => b.key === "dhuhr")!;
    expect(thursdayDhuhr.fridayDhuhr).toBe(false);
    expect((thursdayDhuhr.end - thursdayDhuhr.start) / 60_000).toBe(20);
  });

  it("skips a prayer that is toggled off", () => {
    const result = resolvePrayerBlocks(
      {
        ...config,
        blocks: { ...blocks(), asr: { enabled: false, duration_min: 20 } },
      },
      "2026-08-26",
      "2026-08-26",
    );
    expect(result.map((b) => b.key)).not.toContain("asr");
    expect(result).toHaveLength(4);
  });

  it("skips a prayer whose duration is zero", () => {
    const result = resolvePrayerBlocks(
      {
        ...config,
        blocks: { ...blocks(), isha: { enabled: true, duration_min: 0 } },
      },
      "2026-08-26",
      "2026-08-26",
    );
    expect(result.map((b) => b.key)).not.toContain("isha");
  });

  it("honours a per-prayer duration override", () => {
    const result = resolvePrayerBlocks(
      {
        ...config,
        blocks: { ...blocks(), maghrib: { enabled: true, duration_min: 45 } },
      },
      "2026-08-26",
      "2026-08-26",
    );
    const maghrib = result.find((b) => b.key === "maghrib")!;
    expect((maghrib.end - maghrib.start) / 60_000).toBe(45);
  });

  it("covers a multi-day range in chronological order", () => {
    const result = resolvePrayerBlocks(config, "2026-08-24", "2026-08-30");
    expect(result).toHaveLength(35);
    const starts = result.map((b) => b.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});
