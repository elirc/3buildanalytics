/**
 * A clickable table header.
 *
 * aria-sort is what tells assistive technology the column is sorted and which
 * way; the arrow glyph alone conveys nothing to a screen reader.
 */
export function SortableHeader({
  column,
  label,
  activeColumn,
  direction,
  onSort
}: {
  column: string;
  label: string;
  activeColumn: string;
  direction: "asc" | "desc";
  onSort: (column: string) => void;
}) {
  const isActive = activeColumn === column;

  return (
    <th
      className="px-4 py-3"
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex items-center gap-1 font-medium text-[var(--muted)] transition hover:text-[var(--foreground)]"
      >
        {label}
        <span aria-hidden="true" className={isActive ? "opacity-100" : "opacity-30"}>
          {isActive && direction === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}
