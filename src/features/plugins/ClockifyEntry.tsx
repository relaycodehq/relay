import { Check, ChevronDown, ChevronUp, MessageSquare } from "lucide-react";
import {
  formatDuration,
  type ClockifyBlock,
  type ClockifyProject,
} from "../../../shared/clockify";
import { IconButton } from "../../ui/ui";
import { clock } from "./clockify-format";

/** Why a stretch has no project, in the words the review uses. */
const emptyReason = (b: ClockifyBlock) =>
  b.reason === "other"
    ? "You were in projects Clockify doesn't track. Pick a project if this was work for one, or leave it out."
    : "Nothing happened in Relay for a while. Pick a project if you were working away from it, or leave it out.";

/** The selected entry: its project, what it says, and where its time came from. */
export function ClockifyEntry({
  block,
  index,
  count,
  projects,
  color,
  relayName,
  threads,
  describing,
  onStep,
  onEdit,
  onCommit,
}: {
  block: ClockifyBlock;
  index: number;
  count: number;
  projects?: ClockifyProject[];
  color: string;
  relayName?: string;
  threads: Record<string, string>;
  describing?: boolean;
  onStep: (by: 1 | -1) => void;
  onEdit: (edit: { clockifyProjectId?: string; description?: string }) => void;
  onCommit: () => void;
}) {
  const sent = !!block.submittedId;
  const titles = block.chatIds.map((id) => threads[id]).filter(Boolean);
  return (
    <section className="clockify-entry" aria-label="Selected entry">
      <header className="clockify-entry-head">
        <div className="clockify-entry-time">
          <b>
            {clock(block.start)} – {clock(block.end)}
          </b>
          <span>{formatDuration(block.end - block.start)}</span>
        </div>
        <div className="clockify-entry-step">
          <IconButton
            label="Previous entry"
            disabled={index === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp size={15} />
          </IconButton>
          <span>
            {index + 1} of {count}
          </span>
          <IconButton
            label="Next entry"
            disabled={index === count - 1}
            onClick={() => onStep(1)}
          >
            <ChevronDown size={15} />
          </IconButton>
        </div>
      </header>

      <label className="clockify-field">
        <span>Clockify project</span>
        <span
          className="clockify-project"
          data-empty={!block.clockifyProjectId || undefined}
          style={{ ["--c" as string]: color }}
        >
          <i aria-hidden />
          <select
            value={block.clockifyProjectId}
            disabled={sent || !projects}
            onChange={(e) => {
              onEdit({ clockifyProjectId: e.target.value });
              onCommit();
            }}
          >
            <option value="">Leave out</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName ? `${p.name} · ${p.clientName}` : p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden />
        </span>
      </label>

      {block.clockifyProjectId && (
        <label className="clockify-field">
          <span>What you worked on</span>
          <textarea
            rows={3}
            value={block.description}
            disabled={sent}
            placeholder={
              describing && !block.description
                ? "Luna is drafting this…"
                : "A line for your timesheet"
            }
            onChange={(e) => onEdit({ description: e.target.value })}
            onBlur={onCommit}
          />
        </label>
      )}

      <div className="clockify-sources">
        <span>Where the time came from</span>
        {block.relayProjectId && titles.length ? (
          <>
            <p>{relayName ?? "A removed project"}</p>
            <ul>
              {titles.map((title, i) => (
                <li key={i}>
                  <MessageSquare size={12} aria-hidden />
                  {title}
                </li>
              ))}
            </ul>
          </>
        ) : block.relayProjectId ? (
          <p>{relayName ?? "A removed project"}, while it was open</p>
        ) : (
          <p>{emptyReason(block)}</p>
        )}
      </div>

      {block.uncertain && !sent && (
        <p className="clockify-entry-note">
          Holds an agent turn that ran over three hours, likely across a
          restart. Check the length.
        </p>
      )}
      {sent && (
        <p className="clockify-entry-note" data-sent>
          <Check size={13} aria-hidden /> In Clockify. Change it there.
        </p>
      )}
    </section>
  );
}
