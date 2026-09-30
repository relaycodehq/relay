// Deep review setups by Start: the one you're on, and More for all of them
// to load, rename, pin or forget.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, History, Pencil, Pin, X } from "lucide-react";
import {
  reviewerPrompt,
  type LeadAgent,
  type ReviewAgent,
} from "../../shared/deep-review";
import { effortLabels } from "../../shared/settings";
import {
  forgetReviewSetup,
  pinReviewSetup,
  renameReviewSetup,
  sameSetup,
  useReviewSetups,
  type ReviewSetupChoice,
  type SavedReviewSetup,
} from "../lib/review-setups";
import { ProviderIcon } from "./ComposerModelPicker";
import { timeAgo } from "./ui";

type Name = (agent: ReviewAgent | LeadAgent) => string;

/** Who reviews, who leads, and the prompts that aren't an agent's own review. */
function summary(entry: SavedReviewSetup, name: Name) {
  const { reviewers, lead } = entry.setup;
  const effort = lead.choice.reasoningEffort;
  const prompts = reviewers.flatMap((r) => {
    const asked = reviewerPrompt(r.provider, r.prompt);
    if (asked.kind === "own") return [];
    const text = asked.text;
    return [
      /^[/$]/.test(text)
        ? text
        : `“${text.length > 40 ? text.slice(0, 40) + "…" : text}”`,
    ];
  });
  return {
    models: reviewers.map(name).join(" · "),
    detail: [
      `${name(lead)}${effort ? ` ${effortLabels[effort]}` : ""} leads`,
      ...prompts,
    ].join(" · "),
  };
}

export function ReviewSetups({
  setup,
  name,
  onLoad,
}: {
  setup: ReviewSetupChoice;
  name: Name;
  onLoad: (setup: ReviewSetupChoice) => void;
}) {
  const { entries, naming } = useReviewSetups();
  const [renaming, setRenaming] = useState(false);
  if (!entries.length) return null;
  const current = entries.find((e) => sameSetup(e.setup, setup));
  // Once you change the setup, the last run is the one to go back to.
  const shown = current ?? entries[0]!;
  const label = (e: SavedReviewSetup) =>
    e.name ?? (naming.has(e.id) ? "Naming…" : summary(e, name).models);
  const { models, detail } = summary(shown, name);
  return (
    <div className="deep-review-setups">
      <History size={12} aria-hidden />
      {renaming ? (
        <RenameInput entry={shown} onDone={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          aria-pressed={shown === current}
          data-naming={(!shown.name && naming.has(shown.id)) || undefined}
          title={[
            shown === entries[0] ? "Your last review" : "",
            models,
            detail,
            "Double-click to rename",
          ]
            .filter(Boolean)
            .join("\n")}
          onClick={() => onLoad(shown.setup)}
          onDoubleClick={() => setRenaming(true)}
        >
          {shown.pinned && <Pin size={10} aria-label="Pinned" />}
          {label(shown)}
        </button>
      )}
      <AllSetups current={current} name={name} label={label} onLoad={onLoad} />
    </div>
  );
}

function RenameInput({
  entry,
  onDone,
  wide,
}: {
  entry: SavedReviewSetup;
  onDone: () => void;
  wide?: boolean;
}) {
  const [value, setValue] = useState(entry.name ?? "");
  const save = () => {
    if (value.trim() && value.trim() !== entry.name)
      renameReviewSetup(entry.id, value);
    onDone();
  };
  return (
    <input
      className={`deep-review-setup-rename${wide ? " wide" : ""}`}
      aria-label="Setup name"
      placeholder="Name this setup"
      autoFocus
      onFocus={(e) => e.target.select()}
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          // Leaves an open menu open.
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    />
  );
}

function AllSetups({
  current,
  name,
  label,
  onLoad,
}: {
  current?: SavedReviewSetup;
  name: Name;
  label: (entry: SavedReviewSetup) => string;
  onLoad: (setup: ReviewSetupChoice) => void;
}) {
  const { entries } = useReviewSetups();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ordered = [
    ...entries.filter((e) => e.pinned),
    ...entries.filter((e) => !e.pinned),
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="deep-review-setups-more"
        aria-label="All review setups"
      >
        More
        <ChevronDown size={12} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="headline-project-positioner"
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            className="headline-project-popup deep-review-setups-menu"
            aria-label="Review setups"
          >
            <div className="deep-review-setups-list">
              {ordered.map((entry) => {
                const { models, detail } = summary(entry, name);
                return (
                  <div
                    key={entry.id}
                    className="deep-review-setups-row"
                    data-current={entry === current || undefined}
                  >
                    {renaming === entry.id ? (
                      <div className="deep-review-setups-load">
                        <RenameInput
                          entry={entry}
                          wide
                          onDone={() => setRenaming(null)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="deep-review-setups-load"
                        onClick={() => {
                          onLoad(entry.setup);
                          setOpen(false);
                        }}
                      >
                        <span className="deep-review-setups-glyphs" aria-hidden>
                          {entry.setup.reviewers.map((r, i) => (
                            <ProviderIcon key={i} provider={r.provider} />
                          ))}
                        </span>
                        <span className="deep-review-setups-text">
                          <strong>{label(entry)}</strong>
                          <small>
                            {entry.name ? `${models} · ${detail}` : detail}
                          </small>
                        </span>
                        <time>
                          {Date.now() - entry.at < 60_000
                            ? "just now"
                            : timeAgo(new Date(entry.at).toISOString())}
                        </time>
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Rename ${label(entry)}`}
                      title="Rename"
                      onClick={() => setRenaming(entry.id)}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-button deep-review-setups-pin"
                      aria-label={`${entry.pinned ? "Unpin" : "Pin"} ${label(entry)}`}
                      aria-pressed={!!entry.pinned}
                      title={
                        entry.pinned
                          ? "Unpin"
                          : "Pin: keeps it at the top and in history"
                      }
                      onClick={() => pinReviewSetup(entry.id, !entry.pinned)}
                    >
                      <Pin size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Forget ${label(entry)}`}
                      title="Forget"
                      onClick={() => forgetReviewSetup(entry.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
