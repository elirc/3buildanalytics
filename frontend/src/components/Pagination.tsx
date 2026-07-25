const PAGE_SIZES = [25, 50, 100] as const;

export function Pagination({
  page,
  pageSize,
  total,
  pageCount,
  onPageChange,
  onPageSizeChange
}: {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  // 1-indexed and inclusive, because "Showing 26-50 of 10,000" is what a person
  // reads, not "offset 25, limit 25".
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  const isFirst = page <= 1;
  const isLast = page >= pageCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm">
      <p className="text-[var(--muted)]">
        {total === 0
          ? "No results"
          : `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${total.toLocaleString()}`}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-[var(--muted)]">
          <span>Rows</span>
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-2xl border border-[var(--border)] bg-white px-3 py-2"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isFirst}
            onClick={() => onPageChange(page - 1)}
            className="rounded-2xl border border-[var(--border)] px-3 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-[var(--surface-2)]"
          >
            Previous
          </button>
          <span className="text-[var(--muted)]">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={isLast}
            onClick={() => onPageChange(page + 1)}
            className="rounded-2xl border border-[var(--border)] px-3 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:bg-[var(--surface-2)]"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
