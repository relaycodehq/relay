import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ClockifyProject } from "../../../shared/clockify";
import type { Project } from "../../../shared/projects";
import { SettingsCard } from "../SettingsCard";

/** Which Clockify project each Relay project's time goes to; untracked ones fold away. */
export function ClockifyProjectMap({
  relayProjects,
  clockifyProjects,
  value,
  onChange,
}: {
  relayProjects: Project[];
  clockifyProjects: ClockifyProject[] | undefined;
  value: Record<string, string>;
  onChange: (projects: Record<string, string>) => void;
}) {
  const [showRest, setShowRest] = useState(false);
  const tracked = relayProjects.filter((p) => value[p.id]);
  const rest = relayProjects.filter((p) => !value[p.id]);
  const row = (p: Project) => {
    const color = clockifyProjects?.find((c) => c.id === value[p.id])?.color;
    return (
      <div key={p.id} className="plugin-map-row">
        <span>{p.name}</span>
        <span className="plugin-map-target">
          <i
            className="plugin-dot"
            style={{ background: color ?? "transparent" }}
          />
          <select
            className="plugin-select"
            aria-label={`Clockify project for ${p.name}`}
            value={value[p.id] ?? ""}
            disabled={!clockifyProjects}
            onChange={(e) => {
              const next = { ...value };
              if (e.target.value) next[p.id] = e.target.value;
              else delete next[p.id];
              onChange(next);
            }}
          >
            <option value="">Not tracked</option>
            {clockifyProjects?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientName ? `${c.name} · ${c.clientName}` : c.name}
              </option>
            ))}
          </select>
        </span>
      </div>
    );
  };
  // With nothing tracked yet there's nothing to fold the rest under.
  const folded = tracked.length > 0 && !showRest;
  return (
    <SettingsCard className="plugin-map">
      {tracked.map(row)}
      {tracked.length > 0 && rest.length > 0 && (
        <button
          className="plugin-fold"
          aria-expanded={showRest}
          onClick={() => setShowRest(!showRest)}
        >
          <ChevronRight size={14} className="plugin-chevron" />
          {rest.length} not tracked
          <span>{rest.map((p) => p.name).join(", ")}</span>
        </button>
      )}
      {!folded && rest.map(row)}
    </SettingsCard>
  );
}
