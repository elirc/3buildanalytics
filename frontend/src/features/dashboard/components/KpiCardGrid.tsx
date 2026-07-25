import { KpiCard } from "./KpiCard";
import { formatNumber, formatPercent } from "../../../lib/chartFormatters";
import type { KpiSummary } from "../../../api/dashboard.api";

/** A metric is either a bare number or, with ?compare, an object with a delta. */
type MetricValue = number | { value: number; previous: number | null; changePercent: number | null };

/**
 * Whether an increase is good news, per metric.
 *
 * Stated explicitly because it cannot be inferred: more events is growth, more
 * failed events is not, and higher latency is worse while higher active users
 * is better.
 */
const HIGHER_IS_BETTER: Record<string, boolean> = {
  totalEvents: true,
  activeUsers: true,
  csvExports: true,
  adminActions: true,
  failedEvents: false,
  errorRate: false,
  averageApiLatencyMs: false,
  backgroundJobFailures: false
};

function read(metric: MetricValue | undefined) {
  if (metric === undefined) {
    return null;
  }
  return typeof metric === "number"
    ? { value: metric, delta: undefined }
    : { value: metric.value, delta: { changePercent: metric.changePercent, previous: metric.previous } };
}

export function KpiCardGrid({ data }: { data: KpiSummary }) {
  const cards: Array<{ key: string; label: string; format: (value: number) => string }> = [
    { key: "totalEvents", label: "Total events", format: formatNumber },
    { key: "activeUsers", label: "Active users", format: formatNumber },
    { key: "failedEvents", label: "Failed events", format: formatNumber },
    { key: "errorRate", label: "Error rate", format: formatPercent },
    { key: "csvExports", label: "CSV exports", format: formatNumber },
    { key: "averageApiLatencyMs", label: "Avg API latency", format: (value) => `${formatNumber(value)} ms` },
    { key: "backgroundJobFailures", label: "Job failures", format: formatNumber },
    { key: "adminActions", label: "Admin actions", format: formatNumber }
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        // Absent means the role may not see it — applyMetricVisibility removed
        // it server-side, so the card simply does not exist.
        const metric = read((data as unknown as Record<string, MetricValue>)[card.key]);
        if (!metric) {
          return null;
        }

        return (
          <KpiCard
            key={card.key}
            label={card.label}
            value={card.format(metric.value)}
            delta={metric.delta}
            higherIsBetter={HIGHER_IS_BETTER[card.key]}
          />
        );
      })}
    </div>
  );
}
