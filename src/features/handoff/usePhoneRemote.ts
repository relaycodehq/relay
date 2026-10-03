import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export function usePhoneRemote() {
  return useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    refetchInterval: 3000,
  });
}
