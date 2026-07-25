import type { Permission } from "../../lib/permissions";

export type WidgetId =
  | "kpi-summary"
  | "events-over-time"
  | "events-by-type"
  | "active-users"
  | "error-rate"
  | "conversion-funnel"
  | "recent-activity"
  | "api-latency"
  | "db-query-time"
  | "queue-depth"
  | "job-failures";

export interface WidgetDefinition {
  id: WidgetId;
  title: string;
  description: string;
  permission: Permission;
  defaultSize: "half" | "full";
}

/**
 * Presentation metadata for each widget, keyed by the same ids the server
 * validates against (backend/src/modules/dashboardConfigs/widgets.ts).
 *
 * The server owns *whether* a widget may appear; this file owns what it looks
 * like. Keeping the copy here means the layout editor can label options without
 * a round trip, and the renderer can skip an unknown id rather than crashing.
 */
export const WIDGET_REGISTRY: Record<WidgetId, WidgetDefinition> = {
  "kpi-summary": {
    id: "kpi-summary",
    title: "KPI summary",
    description: "Headline numbers for the selected range.",
    permission: "dashboard:view",
    defaultSize: "full"
  },
  "events-over-time": {
    id: "events-over-time",
    title: "Events over time",
    description: "Chart-ready server aggregation for event volume trends.",
    permission: "dashboard:view",
    defaultSize: "half"
  },
  "events-by-type": {
    id: "events-by-type",
    title: "Events by type",
    description: "Backend aggregation keeps the frontend lightweight.",
    permission: "dashboard:view",
    defaultSize: "half"
  },
  "active-users": {
    id: "active-users",
    title: "Active users",
    description: "Distinct actors bucketed by date on the backend.",
    permission: "dashboard:view",
    defaultSize: "half"
  },
  "error-rate": {
    id: "error-rate",
    title: "Error rate over time",
    description: "Failure ratio computed on the server from raw tracked events.",
    permission: "dashboard:view",
    defaultSize: "full"
  },
  "conversion-funnel": {
    id: "conversion-funnel",
    title: "Conversion funnel",
    description: "Funnel stages derived from tracked event types.",
    permission: "dashboard:view",
    defaultSize: "half"
  },
  "recent-activity": {
    id: "recent-activity",
    title: "Recent activity",
    description: "The most recent tracked events in range.",
    permission: "dashboard:view",
    defaultSize: "full"
  },
  "api-latency": {
    id: "api-latency",
    title: "API latency",
    description: "Time-series monitoring feed for API responsiveness.",
    permission: "monitoring:view",
    defaultSize: "half"
  },
  "db-query-time": {
    id: "db-query-time",
    title: "DB query time",
    description: "Database timing trend.",
    permission: "monitoring:view",
    defaultSize: "half"
  },
  "queue-depth": {
    id: "queue-depth",
    title: "Queue depth",
    description: "Background job backlog.",
    permission: "monitoring:view",
    defaultSize: "half"
  },
  "job-failures": {
    id: "job-failures",
    title: "Recent job failures",
    description: "Background job failures recorded as tracked events.",
    permission: "monitoring:view",
    defaultSize: "full"
  }
};

export const ALL_WIDGET_IDS = Object.keys(WIDGET_REGISTRY) as WidgetId[];

export function isKnownWidget(id: string): id is WidgetId {
  return id in WIDGET_REGISTRY;
}

export interface LayoutWidget {
  id: WidgetId;
  size: "half" | "full";
}

export interface DashboardLayout {
  widgets: LayoutWidget[];
}

/** Built-in layout used when a role has no saved config. */
export const FALLBACK_LAYOUT: DashboardLayout = {
  widgets: [
    { id: "kpi-summary", size: "full" },
    { id: "events-over-time", size: "half" },
    { id: "events-by-type", size: "half" },
    { id: "error-rate", size: "full" },
    { id: "recent-activity", size: "full" }
  ]
};
