import { AppError } from "../errors/AppError.js";
import { ERROR_CODES } from "../errors/errorCodes.js";

const MAX_RAW_QUERY_RANGE_DAYS = 180;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Parses an inclusive date range.
 *
 * Everything here is UTC, deliberately and consistently. The database stores
 * UTC, and the date_trunc bucketing in dashboard.repository.ts groups in the
 * database's timezone, so introducing a second timezone at the API boundary
 * would make chart buckets and range filters disagree at the edges.
 *
 * A date-only string denotes a whole day:
 *   startDate "2026-01-15" -> 2026-01-15T00:00:00.000Z
 *   endDate   "2026-01-15" -> 2026-01-15T23:59:59.999Z
 *
 * That end-of-day expansion is the fix for the bug this function used to have.
 * `new Date("2026-01-15")` is midnight UTC, so an inclusive-sounding filter of
 * `occurredAt <= endDate` actually excluded the entire final day. Since the
 * frontend's default range ends on today, *today's data was missing from every
 * dashboard, chart and export* — the most visible symptom being a final bucket
 * that looked mysteriously empty.
 *
 * A full ISO datetime is honoured verbatim, so a caller who wants a precise
 * window is not silently widened to whole days.
 */
export function parseDateRange(
  startDate: string,
  endDate: string,
  options?: { maxRangeDays?: number }
): DateRange {
  const start = parseBoundary(startDate, "start");
  const end = parseBoundary(endDate, "end");

  if (start.getTime() > end.getTime()) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "startDate must be before endDate", 400);
  }

  const maxRangeDays = options?.maxRangeDays ?? MAX_RAW_QUERY_RANGE_DAYS;

  // Measured between the two days' *starts*, not between the normalised
  // boundaries. Otherwise the end-of-day expansion adds 0.99999 days to every
  // range and a window that was exactly at the limit would start failing.
  const spanDays = (startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime()) / MS_PER_DAY;

  if (spanDays > maxRangeDays) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      `Date range exceeds the ${maxRangeDays} day limit`,
      400
    );
  }

  return { startDate: start, endDate: end };
}

function parseBoundary(value: string, edge: "start" | "end"): Date {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Invalid date range provided", 400);
  }

  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];

    // Validate the calendar explicitly. `new Date("2026-2-31")` is not ISO, so
    // V8 falls back to legacy parsing and silently rolls it over to March 3rd.
    // A caller who typed an impossible date deserves a 400, not a quiet answer
    // about a different day.
    if (!isRealCalendarDate(year, month, day)) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, `Invalid date: ${value}`, 400);
    }

    return edge === "start"
      ? new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
      : new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "Invalid date range provided", 400);
  }

  return parsed;
}

function isRealCalendarDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  // Day 0 of the next month is the last day of this one, and Date.UTC handles
  // leap years for us.
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDayOfMonth;
}

function startOfUtcDay(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)
  );
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
