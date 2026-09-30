// Recent setups by Start, named by the helper agent: the one you're on as a
// quiet word, and More for all of them, to rename, pin and drop.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, History, Pencil, Pin, X } from "lucide-react";
import type { Saved, SetupStore } from "./review-prompts-data";
import { SavedSummary, useSummary } from "./review-prompts-parts";

export function RecentSetups({ store }: { store: SetupStore }) {
  const summary = useSummary();
  const [renaming, setRenaming] = useState<string | null>(null);
  const { saved, current } = store;
  if (!saved.length) return null;
  const last = saved[0]!;
  // The setup you're on; once you edit it, the last run to go back to.
  const shown = [current ?? last];
  const tip = (entry: Saved) => {
    const { models, detail } = summary(entry);
    return [
      entry === last && "Your last review",
      models,
      detail,
      "Double-click to rename",
    ]
      .filter(Boolean)
      .join("\n");
  };
  return (
    <div className="rp-recent" role="radiogroup" aria-label="Recent setups">
      <History size={12} aria-hidden />
      {shown.map((entry) =>
        renaming === entry.id ? (
          <RenameInput
            key={entry.id}
            entry={entry}
            store={store}
            onDone={() => setRenaming(null)}
          />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={entry === current}
            data-naming={!entry.name || undefined}
            title={tip(entry)}
            onClick={() => store.load(entry)}
            onDoubleClick={() => entry.name && setRenaming(entry.id)}
          >
            {entry.pinned && <Pin size={10} aria-label="Pinned" />}
            {entry.name ?? "Naming…"}
          </button>
        ),
      )}
      <AllSetups store={store} />
    </div>
  );
}

function RenameInput({
  entry,
  store,
  onDone,
}: {
  entry: Saved;
  store: SetupStore;
  onDone: () => void;
}) {
  const [value, setValue] = useState(entry.name ?? "");
  const save = () => {
    if (value.trim() && value.trim() !== entry.name)
      store.rename(entry.id, value.trim());
    onDone();
  };
  return (
    <input
      className="rp-rename"
      aria-label={`Rename ${entry.name ?? "setup"}`}
      autoFocus
      onFocus={(e) => e.target.select()}
      value={value}
      maxLength={60}
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

function AllSetups({ store }: { store: SetupStore }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className="rp-recent-more"
        aria-label="All recent setups"
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
            className="headline-project-popup rp-history"
            aria-label="Recent setups"
          >
            <div className="rp-history-scroll">
              {[
                ...store.saved.filter((e) => e.pinned),
                ...store.saved.filter((e) => !e.pinned),
              ].map((entry) => (
                <div
                  key={entry.id}
                  className="rp-history-row"
                  data-current={entry === store.current || undefined}
                >
                  {renaming === entry.id ? (
                    <div className="rp-history-rename">
                      <RenameInput
                        entry={entry}
                        store={store}
                        onDone={() => setRenaming(null)}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="rp-history-load"
                      onClick={() => {
                        store.load(entry);
                        setOpen(false);
                      }}
                    >
                      <SavedSummary entry={entry} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rename ${entry.name ?? "this setup"}`}
                    title="Rename"
                    disabled={!entry.name}
                    onClick={() => setRenaming(entry.id)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="icon-button rp-pin"
                    aria-label={`${entry.pinned ? "Unpin" : "Pin"} ${entry.name ?? "this setup"}`}
                    aria-pressed={!!entry.pinned}
                    title={
                      entry.pinned
                        ? "Unpin"
                        : "Pin: keeps it by Start and in history"
                    }
                    onClick={() => store.togglePin(entry.id)}
                  >
                    <Pin size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Forget ${entry.name ?? "this setup"}`}
                    title="Forget"
                    onClick={() => store.forget(entry.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
