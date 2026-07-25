import { Card } from "../../../components/ui/card";

/**
 * A KPI tile, optionally showing movement against the previous period.
 *
 * `higherIsBetter` is required whenever a delta is shown, and deliberately has
 * no sensible default: more events is good, more errors is not, and guessing
 * wrong paints a worsening metric green. The direction is a property of the
 * metric, so the caller must state it.
 */
export function KpiCard({
  label,
  value,
  detail,
  delta,
  higherIsBetter
}: {
  label: string;
  value: string;
  detail?: string;
  delta?: { changePercent: number | null; previous: number | null };
  higherIsBetter?: boolean;
}) {
  return (
    <Card className="bg-[linear-gradient(180deg,#fffdf8_0%,#f7f1e5_100%)]">
      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</p>
      <p className="mt-4 text-3xl font-semibold">{value}</p>
      {delta ? <Delta delta={delta} higherIsBetter={higherIsBetter ?? true} /> : null}
      {detail ? <p className="mt-2 text-sm text-[var(--muted)]">{detail}</p> : null}
    </Card>
  );
}

function Delta({
  delta,
  higherIsBetter
}: {
  delta: { changePercent: number | null; previous: number | null };
  higherIsBetter: boolean;
}) {
  // Growth from zero is undefined, not infinite. An em dash is honest;
  // "Infinity%" costs the reader their trust in every other number on the page.
  if (delta.changePercent === null) {
    return <p className="mt-2 text-sm text-[var(--muted)]">— no prior period</p>;
  }

  const rose = delta.changePercent > 0;
  const flat = delta.changePercent === 0;
  const good = flat ? null : rose === higherIsBetter;

  const colour =
    good === null ? "text-[var(--muted)]" : good ? "text-[#2f7d63]" : "text-[var(--danger)]";
  const arrow = flat ? "→" : rose ? "↑" : "↓";

  return (
    <p className={`mt-2 text-sm font-medium ${colour}`}>
      <span aria-hidden="true">{arrow} </span>
      {Math.abs(delta.changePercent).toFixed(1)}%
      <span className="ml-1 font-normal text-[var(--muted)]">vs previous period</span>
    </p>
  );
}
