import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { AddComputer } from "./AddComputer";
import { ComputerCard } from "./ComputerCard";
import { MapDiagram } from "./MapDiagram";
import "./computers.css";
import { usePoll } from "../../lib/poll";

/**
 * Settings → Computers: this computer, a wire out to each paired one with a
 * dot per thread over there, and the picked computer's threads below. The
 * last box pairs another one.
 */
export function ComputersMap({
  onOpenChat,
}: {
  onOpenChat?: (projectId: string, chatId: string) => void;
}) {
  const poll = usePoll();
  const overview = useQuery({
    queryKey: ["computers-overview"],
    queryFn: () => api.computersOverview(),
    refetchInterval: poll(3000),
  });
  const [picked, setPicked] = useState<string>();
  // Bumped by the Add box, so it lands in the field even when it shows.
  const [addFocus, setAddFocus] = useState(0);
  const data = overview.data;
  const computers = data?.computers ?? [];
  const current =
    computers.find((c) => c.id === picked) ??
    (picked === "add" ? undefined : computers[0]);
  return (
    <>
      {data && (
        <MapDiagram
          self={data.name}
          computers={computers}
          picked={current?.id ?? "add"}
          onPick={(id) => {
            setPicked(id);
            if (id === "add") setAddFocus((n) => n + 1);
          }}
        />
      )}
      {data && (
        <div className="cm-detail">
          {current && (
            <ComputerCard
              key={current.id}
              computer={current}
              onOpenChat={onOpenChat}
              onForgot={() => setPicked(undefined)}
            />
          )}
          {/* Kept while another computer shows, so a checkup or install carries on. */}
          <div hidden={!!current}>
            <AddComputer
              focusRequest={addFocus}
              onStart={() => setPicked("add")}
            />
          </div>
        </div>
      )}
      {!!overview.error && <ErrorBox error={overview.error} />}
    </>
  );
}
