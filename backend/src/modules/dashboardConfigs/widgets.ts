import type { Permission } from "../../shared/permissions.js";

/**
 * The widget catalogue.
 *
 * The server owns this list, not the client, for two reasons: it can reject a
 * layout naming a widget that does not exist, and it can strip widgets a role
 * is not allowed to see. A config that lists queue-depth must not hand a
 * monitoring widget to an ops manager just because someone saved it that way.
 */
export const WIDGETS = {
  "kpi-summary": { permission: "dashboard:view" },
  "events-over-time": { permission: "dashboard:view" },
  "events-by-type": { permission: "dashboard:view" },
  "active-users": { permission: "dashboard:view" },
  "error-rate": { permission: "dashboard:view" },
  "conversion-funnel": { permission: "dashboard:view" },
  "recent-activity": { permission: "dashboard:view" },
  "api-latency": { permission: "monitoring:view" },
  "db-query-time": { permission: "monitoring:view" },
  "queue-depth": { permission: "monitoring:view" },
  "job-failures": { permission: "monitoring:view" }
} as const satisfies Record<string, { permission: Permission }>;

export type WidgetId = keyof typeof WIDGETS;

export const WIDGET_IDS = Object.keys(WIDGETS) as WidgetId[];

export function widgetPermission(id: WidgetId): Permission {
  return WIDGETS[id].permission;
}
