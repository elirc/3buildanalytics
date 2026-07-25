import { AppError } from "../../src/shared/errors/AppError.js";
import { parseDateRange, toIsoDate } from "../../src/shared/utils/dates.js";

describe("parseDateRange", () => {
  it("expands a date-only range to cover whole days", () => {
    const range = parseDateRange("2026-01-15", "2026-01-15");

    expect(range.startDate.toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-01-15T23:59:59.999Z");
  });

  /**
   * The regression this story exists to fix. An event at 18:00 on the final day
   * of the range used to fall outside it, because endDate resolved to midnight.
   */
  it("includes an event late on the final day", () => {
    const range = parseDateRange("2026-01-01", "2026-01-31");
    const lateOnLastDay = new Date("2026-01-31T18:30:00.000Z");

    expect(lateOnLastDay >= range.startDate).toBe(true);
    expect(lateOnLastDay <= range.endDate).toBe(true);
  });

  it("honours a full ISO datetime verbatim instead of widening it", () => {
    const range = parseDateRange("2026-01-15T09:00:00.000Z", "2026-01-15T17:00:00.000Z");

    expect(range.startDate.toISOString()).toBe("2026-01-15T09:00:00.000Z");
    expect(range.endDate.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("rejects an inverted range", () => {
    expect(() => parseDateRange("2026-01-31", "2026-01-01")).toThrow(AppError);
    expect(() => parseDateRange("2026-01-31", "2026-01-01")).toThrow(/before/i);
  });

  it.each(["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"])(
    "rejects the impossible date %s",
    (value) => {
      expect(() => parseDateRange(value, "2026-12-01")).toThrow(AppError);
    }
  );

  it("accepts a real leap day and rejects a fake one", () => {
    expect(() => parseDateRange("2024-02-29", "2024-03-01")).not.toThrow();
    expect(() => parseDateRange("2026-02-29", "2026-03-01")).toThrow(AppError);
  });

  it.each(["", "not-a-date", "15/01/2026"])("rejects the unparseable input %s", (value) => {
    expect(() => parseDateRange(value, "2026-12-01")).toThrow(AppError);
  });

  it("enforces the default 180-day cap", () => {
    // 2026-01-01 -> 2026-07-01 is 181 days.
    expect(() => parseDateRange("2026-01-01", "2026-07-01")).toThrow(/180 day limit/);
  });

  it("measures the cap in whole days so a range exactly at the limit passes", () => {
    // 2026-01-01 -> 2026-06-30 is exactly 180 days apart. If the cap were
    // measured against the expanded end-of-day boundary it would come out as
    // 180.99999 days and this would fail — which is why spanDays is computed
    // between the two days' starts.
    expect(() => parseDateRange("2026-01-01", "2026-06-30", { maxRangeDays: 180 })).not.toThrow();
    expect(() => parseDateRange("2026-01-01", "2026-07-01", { maxRangeDays: 180 })).toThrow();
  });

  it("allows a wider cap for dashboard queries", () => {
    expect(() => parseDateRange("2025-06-01", "2026-05-01", { maxRangeDays: 365 })).not.toThrow();
  });
});

describe("toIsoDate", () => {
  it("formats a date as YYYY-MM-DD in UTC", () => {
    expect(toIsoDate(new Date("2026-01-15T23:59:59.999Z"))).toBe("2026-01-15");
  });
});
