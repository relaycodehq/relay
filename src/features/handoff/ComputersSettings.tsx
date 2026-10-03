import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import { AddComputer } from "./AddComputer";
import { ComputerCard } from "./ComputerCard";
import { MapDiagram } from "./MapDiagram";
import "./computers.css";

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
  const overview = useQuery({
    queryKey: ["computers-overview"],
    queryFn: () => api.computersOverview(),
    refetchInterval: 3000,
  });
  const [picked, setPicked] = useState<string>();
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
          onPick={setPicked}
        />
      )}
      {data && (
        <div className="cm-detail">
          {current ? (
            <ComputerCard
              key={current.id}
              computer={current}
              onOpenChat={onOpenChat}
              onForgot={() => setPicked(undefined)}
            />
          ) : (
            <AddComputer onPaired={setPicked} />
          )}
        </div>
      )}
      {!!overview.error && <ErrorBox error={overview.error} />}
    </>
  );
}
