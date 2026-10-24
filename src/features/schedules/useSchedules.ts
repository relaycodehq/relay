import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Schedule } from "../../../shared/schedules";

const key = ["schedules"] as const;

/** The schedules, kept current as Relay saves them and their runs move. */
export function useSchedules() {
  const qc = useQueryClient();
  useEffect(
    () => api.onSchedules((list) => qc.setQueryData<Schedule[]>(key, list)),
    [qc],
  );
  return useQuery({ queryKey: key, queryFn: () => api.schedules() });
}
