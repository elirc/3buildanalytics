import { formatDateTime, getDefaultDateRange } from "../lib/formatDate";

describe("getDefaultDateRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ends on today and spans 30 inclusive days", () => {
    const range = getDefaultDateRange();

    const today = new Date();
    const expectedEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;

    expect(range.endDate).toBe(expectedEnd);

    const start = new Date(`${range.startDate}T00:00:00Z`);
    const end = new Date(`${range.endDate}T00:00:00Z`);
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    expect(days).toBe(29); // 29 days apart == 30 inclusive days
  });

  /**
   * The bug: the old implementation walked the calendar with local getters and
   * then formatted with toISOString(), which is UTC. Late in the evening west
   * of UTC those disagree and endDate came out as *tomorrow*.
   *
   * 2026-01-15T23:30 local in UTC-5 is 2026-01-16T04:30Z, so a UTC formatter
   * would have said "2026-01-16".
   */
  it("does not roll over to tomorrow late in the day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T23:30:00"));

    const range = getDefaultDateRange();

    expect(range.endDate).toBe("2026-01-15");
  });

  it("is stable early in the day too", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T00:30:00"));

    expect(getDefaultDateRange().endDate).toBe("2026-01-15");
  });

  it("produces a well-formed range", () => {
    const range = getDefaultDateRange();
    expect(range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.startDate <= range.endDate).toBe(true);
  });
});

describe("formatDateTime", () => {
  it("keeps the time, unlike formatDate", () => {
    const formatted = formatDateTime("2026-01-15T14:45:00.000Z");
    // Locale-dependent, so assert it carries more than a bare date.
    expect(formatted.length).toBeGreaterThan("1/15/2026".length);
  });
});
