import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/poll";

export function usePhoneRemote() {
  const poll = usePoll();
  return useQuery({
    queryKey: ["phone-remote"],
    queryFn: () => api.phoneRemoteState(),
    refetchInterval: poll(3000),
  });
}
