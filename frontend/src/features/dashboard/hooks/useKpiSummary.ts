import { useQuery } from "@tanstack/react-query";

import { getKpiSummary } from "../../../api/dashboard.api";

export function useKpiSummary(startDate: string, endDate: string, compare = false) {
  return useQuery({
    // compare changes the response shape, so it belongs in the key.
    queryKey: ["dashboard", "kpi-summary", startDate, endDate, compare],
    queryFn: () => getKpiSummary({ startDate, endDate, compare })
  });
}
