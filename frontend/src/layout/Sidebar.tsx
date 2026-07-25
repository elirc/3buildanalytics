import { NavLink } from "react-router-dom";

import { useAuthStore } from "../auth/auth.store";
import { hasPermission, type Permission } from "../lib/permissions";

/**
 * Every link declares the permission its page requires — the same permission
 * the API enforces on the endpoints that page calls.
 *
 * Previously five links were unconditional and the rest were conditional
 * spreads over ad-hoc role lists. That showed Exports to read-only and
 * executive users (who lack exports:view) and Engineering to everyone (though
 * it calls monitoring endpoints), so those users clicked through to a page that
 * could only fail.
 */
const LINKS: Array<{ to: string; label: string; permission: Permission }> = [
  { to: "/", label: "Operations", permission: "dashboard:view" },
  { to: "/product", label: "Product", permission: "dashboard:view" },
  { to: "/engineering", label: "Engineering", permission: "monitoring:view" },
  { to: "/executive", label: "Executive", permission: "dashboard:view" },
  { to: "/exports", label: "Exports", permission: "exports:view" },
  { to: "/events", label: "Events", permission: "events:view" },
  { to: "/audit", label: "Audit", permission: "audit:view" },
  { to: "/monitoring", label: "Monitoring", permission: "monitoring:view" },
  { to: "/dashboard-configs", label: "Configs", permission: "dashboard:configure" }
];

export function Sidebar() {
  const role = useAuthStore((state) => state.user?.role);
  const granted = useAuthStore((state) => state.user?.permissions);

  if (!role) {
    return null;
  }

  const links = LINKS.filter((link) => hasPermission(role, link.permission, granted));

  return (
    <aside className="rounded-[2rem] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-6 rounded-3xl bg-[var(--primary-soft)] p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--primary)]">Role-aware</p>
        <h2 className="mt-2 text-lg font-semibold text-[var(--primary)]">Navigation</h2>
      </div>
      <nav className="space-y-2">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.to === "/"}
            className={({ isActive }) =>
              [
                "block rounded-2xl px-4 py-3 text-sm font-medium transition",
                isActive ? "bg-[var(--primary)] text-white" : "text-[var(--foreground)] hover:bg-[var(--surface-2)]"
              ].join(" ")
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
