import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router-dom";

import { RequireAuth } from "../auth/RequireAuth";
import { RequirePermission } from "../auth/RequirePermission";
import { LoginPage } from "../auth/LoginPage";
import { AppLayout } from "../layout/AppLayout";
import { LoadingState } from "../components/LoadingState";

const AuditDashboardPage = lazy(() => import("../features/audit/pages/AuditDashboardPage").then((module) => ({ default: module.AuditDashboardPage })));
const OperationsDashboardPage = lazy(() => import("../features/dashboard/pages/OperationsDashboardPage").then((module) => ({ default: module.OperationsDashboardPage })));
const EngineeringDashboardPage = lazy(() => import("../features/dashboard/pages/EngineeringDashboardPage").then((module) => ({ default: module.EngineeringDashboardPage })));
const ExecutiveDashboardPage = lazy(() => import("../features/dashboard/pages/ExecutiveDashboardPage").then((module) => ({ default: module.ExecutiveDashboardPage })));
const ProductDashboardPage = lazy(() => import("../features/dashboard/pages/ProductDashboardPage").then((module) => ({ default: module.ProductDashboardPage })));
const EventLogPage = lazy(() => import("../features/events/pages/EventLogPage").then((module) => ({ default: module.EventLogPage })));
const EventDetailPage = lazy(() => import("../features/events/pages/EventDetailPage").then((module) => ({ default: module.EventDetailPage })));
const MonitoringDashboardPage = lazy(() => import("../features/monitoring/pages/MonitoringDashboardPage").then((module) => ({ default: module.MonitoringDashboardPage })));
const ExportCenterPage = lazy(() => import("../features/exports/pages/ExportCenterPage").then((module) => ({ default: module.ExportCenterPage })));
const DashboardConfigPage = lazy(() => import("../features/dashboardConfigs/pages/DashboardConfigPage").then((module) => ({ default: module.DashboardConfigPage })));

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<LoadingState label="Loading page..." />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          // Guarded by permission, never by a role list. Each permission below
          // is the one the API enforces on the endpoints that page calls, so
          // the router and the server cannot disagree about who gets in.
          {
            element: <RequirePermission permission="dashboard:view" />,
            children: [
              { path: "/", element: withSuspense(<OperationsDashboardPage />) },
              { path: "/product", element: withSuspense(<ProductDashboardPage />) },
              { path: "/executive", element: withSuspense(<ExecutiveDashboardPage />) }
            ]
          },
          {
            element: <RequirePermission permission="monitoring:view" />,
            children: [
              { path: "/engineering", element: withSuspense(<EngineeringDashboardPage />) },
              { path: "/monitoring", element: withSuspense(<MonitoringDashboardPage />) }
            ]
          },
          {
            element: <RequirePermission permission="exports:view" />,
            children: [{ path: "/exports", element: withSuspense(<ExportCenterPage />) }]
          },
          {
            element: <RequirePermission permission="events:view" />,
            children: [
              { path: "/events", element: withSuspense(<EventLogPage />) },
              { path: "/events/:id", element: withSuspense(<EventDetailPage />) }
            ]
          },
          {
            element: <RequirePermission permission="audit:view" />,
            children: [{ path: "/audit", element: withSuspense(<AuditDashboardPage />) }]
          },
          {
            element: <RequirePermission permission="dashboard:configure" />,
            children: [{ path: "/dashboard-configs", element: withSuspense(<DashboardConfigPage />) }]
          }
        ]
      }
    ]
  }
]);
