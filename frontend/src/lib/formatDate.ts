/**
 * Date helpers.
 *
 * The wire format for filters is always `YYYY-MM-DD`, never a Date object. The
 * backend reads those as whole UTC days (see backend/src/shared/utils/dates.ts).
 */

/** Date only, in the viewer's locale. Use for columns where time is noise. */
export function formatDate(date: string) {
  return new Date(date).toLocaleDateString();
}

/**
 * Date and time, in the viewer's locale.
 *
 * Audit and export tables previously used formatDate, which threw the time away
 * — unhelpful when two entries land on the same day and you need to know their
 * order, which is most of what an audit trail is for.
 */
export function formatDateTime(date: string) {
  return new Date(date).toLocaleString();
}

/** Local calendar date as YYYY-MM-DD. */
function toLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The last 30 days, inclusive of today.
 *
 * This used to mix timezones: it walked the calendar with local getters
 * (`setDate(getDate() - 29)`) and then formatted with `toISOString()`, which is
 * UTC. West of UTC that pair can yield tomorrow's date; east of it, yesterday's.
 * Both endpoints are now computed and formatted in the same (local) timezone.
 *
 * The backend interprets the result as UTC days. For a user far from UTC the
 * window is therefore shifted by a few hours at its edges — acceptable while
 * the product has no timezone preference, and far better than the previous
 * behaviour of silently dropping the current day entirely.
 */
export function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);

  return {
    startDate: toLocalIsoDate(start),
    endDate: toLocalIsoDate(end)
  };
}
