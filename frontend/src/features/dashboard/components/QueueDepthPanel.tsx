import type { QueueDepth } from "../../../api/monitoring.api";
import { KpiCard } from "./KpiCard";

/**
 * Shows both queue-depth sources side by side.
 *
 * "In queue" is what BullMQ reports; "Job rows" is what the database says.
 * They should agree. When they do not, that disagreement *is* the finding —
 * jobs waiting in Redis with no consumer, or rows marked pending that the
 * queue has never heard of — so collapsing them into one number would discard
 * the only signal worth having here.
 */
export function QueueDepthPanel({ data }: { data: QueueDepth }) {
  const queued = data.queue ? data.queue.waiting + data.queue.active + data.queue.delayed : null;
  const rows = data.jobs.pending + data.jobs.processing;

  // Small differences are normal — a job can be claimed between the two reads.
  const diverged = queued !== null && Math.abs(queued - rows) > 1;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <KpiCard
          label="In queue (Redis)"
          value={queued === null ? "unavailable" : String(queued)}
          detail={data.queue ? `${data.queue.delayed} delayed · ${data.queue.failed} failed` : undefined}
        />
        <KpiCard
          label="Job rows (database)"
          value={String(rows)}
          detail={`${data.jobs.failed} failed`}
        />
      </div>

      {!data.redisAvailable ? (
        <p role="status" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-[#8a5a00]">
          Redis is unreachable, so these are database counts only. Queued work may not be running.
        </p>
      ) : null}

      {diverged ? (
        <p role="status" className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-[#8a5a00]">
          The queue and the database disagree ({queued} vs {rows}). Jobs may be stuck, or a worker
          may not be running.
        </p>
      ) : null}
    </div>
  );
}
