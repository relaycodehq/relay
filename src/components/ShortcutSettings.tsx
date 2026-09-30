import { Plus, RotateCcw } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  command,
  MAX_BINDINGS,
  recordCombo,
  sameCombo,
  type KeyCombo,
  type ShortcutId,
} from "../../shared/shortcuts";
import { mac } from "../lib/mod-key";
import {
  comboLabel,
  conflictOf,
  defaultBindings,
  isCustomized,
  modifiersLabel,
  reassign,
  resetAllBindings,
  resetBindings,
  setBindings,
  setRecording,
  useBindings,
  useCustomizedCount,
} from "../lib/shortcuts";
import "./shortcuts.css";

/** Which binding is being recorded: an existing one, or a new one after them. */
type Slot = number;

type Edit =
  | { kind: "record"; slot: Slot; held: string; problem?: string }
  | { kind: "confirm"; slot: Slot; combo: KeyCombo; other: ShortcutId };

const label = (id: ShortcutId, combo: KeyCombo) =>
  comboLabel(combo, command(id).digits);

/**
 * A command's keys in Settings. Click one and press the new keys; Esc keeps
 * the old ones, ⌫ removes them. Keys another command has ask before moving.
 */
export function ShortcutKeys({ id }: { id: ShortcutId }) {
  const list = useBindings(id);
  const [edit, setEdit] = useState<Edit>();
  const [saved, setSaved] = useState<Slot>();
  const recorder = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const recording = edit?.kind === "record";
  const title = command(id).title;
  const customized = isCustomized(id);

  // Menu keys and every other shortcut stand down while one is recorded.
  useEffect(() => {
    if (!recording) return;
    setRecording(true);
    recorder.current?.focus();
    return () => setRecording(false);
  }, [recording]);
  useEffect(() => {
    if (edit?.kind === "confirm") confirm.current?.focus();
  }, [edit?.kind]);

  const commit = (slot: Slot, combo: KeyCombo, other?: ShortcutId) => {
    const next = [...list];
    next[slot] = combo;
    // Two slots with the same keys would only need one.
    const unique = next.filter(
      (c, i) => next.findIndex((d) => sameCombo(c, d)) === i,
    );
    if (other) reassign(id, unique, combo);
    else setBindings(id, unique);
    setEdit(undefined);
    setSaved(unique.findIndex((c) => sameCombo(c, combo)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (edit?.kind !== "record") return;
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (e.key === "Escape" && plain) return setEdit(undefined);
    if ((e.key === "Backspace" || e.key === "Delete") && plain) {
      setBindings(
        id,
        list.filter((_, i) => i !== edit.slot),
      );
      return setEdit(undefined);
    }
    const recorded = recordCombo(e, id, mac);
    // Starting over clears what was wrong with the last try.
    if (recorded.kind === "wait")
      return setEdit({
        kind: "record",
        slot: edit.slot,
        held: modifiersLabel(modifiersOf(e)),
      });
    if (recorded.kind === "invalid")
      return setEdit({ ...edit, held: "", problem: recorded.reason });
    const combo = recorded.combo;
    if (list.some((c, i) => i !== edit.slot && sameCombo(c, combo)))
      return setEdit(undefined);
    const conflict = conflictOf(id, combo);
    if (conflict?.kind === "reserved")
      return setEdit({
        ...edit,
        held: "",
        problem: `${label(id, combo)} ${conflict.what}. Try another.`,
      });
    if (conflict)
      return setEdit({
        kind: "confirm",
        slot: edit.slot,
        combo,
        other: conflict.id,
      });
    commit(edit.slot, combo);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (edit?.kind === "record" && !edit.problem)
      setEdit({ ...edit, held: modifiersLabel(modifiersOf(e)) });
  };

  const start = (slot: Slot) => {
    setSaved(undefined);
    setEdit({ kind: "record", slot, held: "" });
  };
  const keycap = (combo: KeyCombo, slot: Slot) => {
    if (edit?.slot === slot) {
      if (edit.kind === "confirm")
        return (
          <span key={slot} className="shortcut-key" data-state="conflict">
            {label(id, edit.combo)}
          </span>
        );
      return recorderKey(slot);
    }
    return (
      <button
        key={slot}
        type="button"
        className="shortcut-key"
        data-custom={customized || undefined}
        data-saved={saved === slot || undefined}
        aria-label={`${title}: ${label(id, combo)}. Change`}
        disabled={!!edit}
        onClick={() => start(slot)}
        onAnimationEnd={() => setSaved(undefined)}
      >
        {label(id, combo)}
      </button>
    );
  };
  const recorderKey = (slot: Slot) => (
    <button
      key={slot}
      ref={recorder}
      type="button"
      className="shortcut-key"
      data-state={
        edit?.kind === "record" && edit.problem ? "problem" : "record"
      }
      aria-label={`New keys for ${title}`}
      aria-describedby={`shortcut-status-${id}`}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => setEdit((e) => (e?.kind === "record" ? undefined : e))}
    >
      {edit?.kind === "record" && edit.held ? `${edit.held}…` : "Press keys"}
    </button>
  );

  const adding = edit?.slot === list.length;
  return (
    <div className="shortcut-row">
      <div className="shortcut-keys" data-editing={edit ? "" : undefined}>
        {list.map(keycap)}
        {adding &&
          (edit.kind === "confirm" ? (
            <span className="shortcut-key" data-state="conflict">
              {label(id, edit.combo)}
            </span>
          ) : (
            recorderKey(list.length)
          ))}
        {!list.length && !edit && (
          <button
            type="button"
            className="shortcut-key"
            data-state="empty"
            aria-label={`Set a shortcut for ${title}`}
            onClick={() => start(0)}
          >
            None
          </button>
        )}
        <span className="shortcut-actions">
          {customized && !edit && (
            <button
              type="button"
              className="shortcut-action"
              data-shown
              aria-label={`Reset ${title} to ${defaultLabel(id) || "no shortcut"}`}
              title={`Reset to ${defaultLabel(id) || "no shortcut"}`}
              onClick={() => {
                resetBindings(id);
                setSaved(0);
              }}
            >
              <RotateCcw size={13} />
            </button>
          )}
          {!!list.length && list.length < MAX_BINDINGS && !edit && (
            <button
              type="button"
              className="shortcut-action shortcut-add"
              aria-label={`Add another shortcut for ${title}`}
              title="Add another shortcut"
              onClick={() => start(list.length)}
            >
              <Plus size={13} />
            </button>
          )}
        </span>
      </div>
      <Status id={id} edit={edit} slot={edit?.slot} list={list}>
        {edit?.kind === "confirm" && (
          <span className="shortcut-status-actions">
            <button
              ref={confirm}
              type="button"
              className="primary"
              onClick={() => commit(edit.slot, edit.combo, edit.other)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // Escape here backs out of the choice, not out of Settings.
                e.preventDefault();
                e.stopPropagation();
                setEdit(undefined);
              }}
            >
              Use here
            </button>
            <button
              type="button"
              onClick={() => setEdit(undefined)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                e.stopPropagation();
                setEdit(undefined);
              }}
            >
              Cancel
            </button>
          </span>
        )}
      </Status>
    </div>
  );
}

function Status({
  id,
  edit,
  slot,
  list,
  children,
}: {
  id: ShortcutId;
  edit?: Edit;
  slot?: Slot;
  list: KeyCombo[];
  children?: ReactNode;
}) {
  let text = "";
  if (edit?.kind === "record")
    text =
      edit.problem ??
      (command(id).digits
        ? `Hold the modifiers and press any digit. Esc cancels${slot! < list.length ? ", ⌫ removes" : ""}.`
        : `Press the new keys. Esc cancels${slot! < list.length ? ", ⌫ removes" : ""}.`);
  if (edit?.kind === "confirm") {
    const other = command(edit.other).title;
    text = `${comboLabel(edit.combo, command(id).digits)} is already “${other}”. Use it here instead?`;
  }
  return (
    <div
      id={`shortcut-status-${id}`}
      className="shortcut-status"
      data-tone={
        edit?.kind === "confirm"
          ? "warn"
          : edit?.kind === "record" && edit.problem
            ? "problem"
            : undefined
      }
      aria-live="polite"
      hidden={!edit}
    >
      <span>{text}</span>
      {children}
    </div>
  );
}

const modifiersOf = (e: KeyboardEvent) => ({
  alt: e.altKey,
  ctrl: e.ctrlKey,
  meta: e.metaKey,
  shift: e.shiftKey,
});

const defaultLabel = (id: ShortcutId) =>
  defaultBindings(id)
    .map((c) => comboLabel(c, command(id).digits))
    .join(" or ");

/** The shortcuts page's first row: how it works, and a way back to defaults. */
export function ShortcutsResetAll() {
  const count = useCustomizedCount();
  if (!count) return <span className="setting-muted">All defaults</span>;
  return (
    <button type="button" onClick={resetAllBindings}>
      <RotateCcw size={13} />
      Reset {count} {count === 1 ? "shortcut" : "shortcuts"}
    </button>
  );
}
