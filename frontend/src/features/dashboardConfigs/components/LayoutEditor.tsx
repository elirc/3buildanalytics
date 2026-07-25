import {
  ALL_WIDGET_IDS,
  WIDGET_REGISTRY,
  type LayoutWidget,
  type WidgetId
} from "../../dashboard/widgetRegistry";

/**
 * Add, remove, reorder and resize the widgets in a layout.
 *
 * Up/down buttons rather than drag-and-drop: they are keyboard accessible for
 * free, work on touch without a gesture library, and are trivially testable.
 * Drag-and-drop would be nicer to demo and worse to use.
 */
export function LayoutEditor({
  widgets,
  onChange
}: {
  widgets: LayoutWidget[];
  onChange: (next: LayoutWidget[]) => void;
}) {
  const selectedIds = new Set(widgets.map((widget) => widget.id));
  const available = ALL_WIDGET_IDS.filter((id) => !selectedIds.has(id));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= widgets.length) {
      return;
    }
    const next = [...widgets];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h4 className="mb-2 text-sm font-semibold">In this dashboard</h4>
        {widgets.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No widgets yet. Add some from the right — an empty layout falls back to the default.
          </p>
        ) : (
          <ul className="space-y-2">
            {widgets.map((widget, index) => (
              <li
                key={`${widget.id}-${index}`}
                className="flex items-center justify-between gap-2 rounded-2xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span>{WIDGET_REGISTRY[widget.id]?.title ?? widget.id}</span>
                <div className="flex items-center gap-1">
                  <select
                    aria-label={`Size for ${widget.id}`}
                    value={widget.size}
                    onChange={(event) => {
                      const next = [...widgets];
                      next[index] = { ...widget, size: event.target.value as "half" | "full" };
                      onChange(next);
                    }}
                    className="rounded-xl border border-[var(--border)] bg-white px-2 py-1 text-xs"
                  >
                    <option value="half">Half</option>
                    <option value="full">Full</option>
                  </select>
                  <button
                    type="button"
                    aria-label={`Move ${widget.id} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded-xl border border-[var(--border)] px-2 py-1 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${widget.id} down`}
                    disabled={index === widgets.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded-xl border border-[var(--border)] px-2 py-1 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${widget.id}`}
                    onClick={() => onChange(widgets.filter((_, i) => i !== index))}
                    className="rounded-xl border border-[var(--border)] px-2 py-1 text-[var(--danger)]"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Available widgets</h4>
        <ul className="space-y-2">
          {available.map((id: WidgetId) => (
            <li
              key={id}
              className="flex items-center justify-between gap-2 rounded-2xl border border-dashed border-[var(--border)] px-3 py-2 text-sm"
            >
              <div>
                <p>{WIDGET_REGISTRY[id].title}</p>
                <p className="text-xs text-[var(--muted)]">{WIDGET_REGISTRY[id].description}</p>
              </div>
              <button
                type="button"
                aria-label={`Add ${id}`}
                onClick={() => onChange([...widgets, { id, size: WIDGET_REGISTRY[id].defaultSize }])}
                className="rounded-xl border border-[var(--border)] px-3 py-1 font-medium"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
