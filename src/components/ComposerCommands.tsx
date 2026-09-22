import {
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  Blocks,
  Folder,
  Settings,
  UserRound,
  Package,
  Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  relayCommands,
  relayCommand,
  commandTrigger,
  type RelayCommand,
} from "../../shared/commands";
import type { SkillPick } from "./ComposerPromptInput";
import { api } from "../lib/api";
export function useComposerCommands({
  draft,
  onDraft,
  projectId,
  provider,
  onCommand,
  input,
  onSkillPick,
  disabled,
}: {
  draft: string;
  onDraft: (text: string) => void;
  projectId: string;
  provider: "codex" | "claude" | "message";
  onCommand: (command: RelayCommand) => boolean;
  input: RefObject<HTMLElement | null>;
  onSkillPick: (skill: SkillPick) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<number>();
  const trigger = commandTrigger(
    draft,
    Math.min(cursor ?? draft.length, draft.length),
  );
  const visible = !!trigger && dismissed !== draft && !disabled;
  const providerCommands = useQuery({
    queryKey: ["provider-commands", projectId, provider],
    queryFn: () =>
      api.projectCommands(
        projectId,
        provider === "claude" ? "claude" : "codex",
      ),
    enabled: visible && provider !== "message",
    staleTime: 60000,
    retry: false,
  });
  const query = trigger?.query.toLowerCase() ?? "";
  const prefix = trigger?.prefix ?? "/";
  const items = [
    ...(prefix === "/"
      ? relayCommands.map((c) => ({
          ...c,
          label: "/" + c.name,
          source: "Relay",
          Icon: Zap,
        }))
      : []),
    ...(provider !== "message" ? (providerCommands.data ?? []) : []).map(
      (c) => ({
        ...c,
        name: prefix === "$" ? c.name.replace(/^skill:/, "") : c.name,
        label:
          (prefix === "/" ? "/skill:" : "") +
          (c.displayName || c.name.replace(/^skill:/, "")),
        source:
          {
            app: "App",
            repo: "Repo",
            project: "Project",
            personal: "Personal",
            system: "System",
            other: "Provider",
          }[c.source ?? "other"] + " Skill",
        Icon: {
          app: Blocks,
          repo: Folder,
          project: Folder,
          personal: UserRound,
          system: Settings,
          other: Package,
        }[c.source ?? "other"],
      }),
    ),
  ]
    .filter((c) => `${c.name} ${c.label}`.toLowerCase().includes(query))
    .slice(0, 60);
  const [bounds, setBounds] = useState({
    left: 0,
    top: 0,
    width: 400,
    maxHeight: 300,
    above: true,
  });
  useEffect(() => {
    setActive(0);
    setError(undefined);
  }, [draft, provider]);
  useLayoutEffect(() => {
    if (!visible) return;
    function measure() {
      const box = (
        input.current?.closest("form") ?? input.current
      )?.getBoundingClientRect();
      if (!box) return;
      const maxHeight = Math.min(288, innerHeight - 24);
      const height = Math.min(maxHeight, items.length * 34 + 16);
      const width = Math.min(box.width, innerWidth - 24);
      setBounds({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        top:
          box.top > height + 12
            ? box.top - 4
            : Math.min(box.bottom + 8, innerHeight - height - 12),
        width,
        maxHeight:
          box.top > height + 12 ? Math.min(288, box.top - 20) : maxHeight,
        above: box.top > height + 12,
      });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible, items.length, input]);
  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    const action =
      item.source === "Relay" ? relayCommand("/" + item.name) : null;
    if (action) {
      if (onCommand(action)) onDraft("");
    } else {
      onSkillPick({
        token: `${prefix}${item.name}`,
        label: item.label.replace(/^\/skill:/, ""),
        start: trigger?.start ?? 0,
        end: trigger?.end ?? draft.length,
      });
    }
  }
  function interceptSend() {
    if (!draft.trim().startsWith("/")) return false;
    const action = relayCommand(draft);
    if (action) {
      if (onCommand(action)) onDraft("");
      return true;
    }
    if (provider === "codex" && /^\/skill:[^\s]+(?:\s|$)/.test(draft.trim()))
      return false;
    setError(
      "Choose a command from the menu. Relay actions run on their own; add instructions after a Codex skill.",
    );
    return true;
  }
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!visible || e.nativeEvent.isComposing || e.keyCode === 229)
      return false;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(draft);
      return true;
    }
    if (["ArrowDown", "ArrowUp"].includes(e.key) && items.length) {
      e.preventDefault();
      setActive(
        (i) =>
          (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length,
      );
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && items.length) {
      e.preventDefault();
      choose(Math.min(active, items.length - 1));
      return true;
    }
    return false;
  }
  useEffect(() => {
    if (visible)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, visible, id]);
  const menu = visible
    ? createPortal(
        <div
          className="composer-command-menu"
          style={{
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            maxHeight: bounds.maxHeight,
            transform: bounds.above ? "translateY(-100%)" : undefined,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div id={id} role="listbox" aria-label="Commands">
            {items.map((item, index) => (
              <button
                key={item.source + item.name}
                type="button"
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                className={index === active ? "selected" : ""}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <strong title={item.label}>{item.label}</strong>
                <small title={item.description}>{item.description}</small>
                <em>
                  <item.Icon size={13} aria-hidden="true" />
                  {item.source}
                </em>
              </button>
            ))}
            {!items.length && <p>No matching commands.</p>}
          </div>
          {providerCommands.isFetching && provider !== "message" && (
            <p>Loading provider skills…</p>
          )}
          {!!providerCommands.error && (
            <p>Provider skills unavailable. Relay actions still work.</p>
          )}
        </div>,
        document.body,
      )
    : null;
  return {
    menu,
    setCursor,
    error,
    visible,
    id,
    activeId: items.length
      ? `${id}-${Math.min(active, items.length - 1)}`
      : undefined,
    onKeyDown,
    interceptSend,
    dismiss: () => setDismissed(draft),
  };
}
