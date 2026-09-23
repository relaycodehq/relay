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
  SquareTerminal,
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
  argumentTrigger,
  type CommandOption,
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
  options,
  input,
  onSkillPick,
  onFill,
  disabled,
}: {
  draft: string;
  onDraft: (text: string) => void;
  projectId: string;
  provider: "codex" | "claude" | "message";
  /** False leaves the draft alone; a string explains why it did not run. */
  onCommand: (command: RelayCommand, args: string) => boolean | string;
  /** Values offered after a command name, e.g. effort levels. */
  options: (command: RelayCommand) => CommandOption[] | undefined;
  input: RefObject<HTMLElement | null>;
  onSkillPick: (skill: SkillPick) => void;
  onFill: (range: { start: number; end: number; text: string }) => void;
  disabled: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();
  const [error, setError] = useState<string>();
  const [cursor, setCursor] = useState<number>();
  const at = Math.min(cursor ?? draft.length, draft.length);
  const trigger = commandTrigger(draft, at);
  const argument = argumentTrigger(draft, at);
  const argCommand = relayCommands.find((c) => c.name === argument?.name);
  const argOptions = argCommand ? options(argCommand.name) : undefined;
  const visible =
    (!!trigger || !!argOptions?.length) && dismissed !== draft && !disabled;
  const providerCommands = useQuery({
    queryKey: ["provider-commands", projectId, provider],
    queryFn: () =>
      api.projectCommands(
        projectId,
        provider === "claude" ? "claude" : "codex",
      ),
    enabled: (visible || draft.startsWith("/")) && provider !== "message",
    staleTime: 60000,
    retry: false,
  });
  const query = (argument?.query ?? trigger?.query ?? "").toLowerCase();
  const prefix = trigger?.prefix ?? "/";
  type Item = {
    kind: "relay" | "argument" | "claude" | "skill";
    name: string;
    label: string;
    description: string;
    source: string;
    Icon: typeof Zap;
  };
  const items: Item[] = (
    argCommand && argOptions
      ? argOptions.map((o) => ({
          kind: "argument" as const,
          name: o.value,
          label: `/${argCommand.name} ${o.label}`,
          description: o.description ?? "",
          source: "Relay",
          Icon: Zap,
        }))
      : [
          ...(prefix === "/"
            ? relayCommands.map((c) => ({
                kind: "relay" as const,
                name: c.name,
                label: "/" + c.name + ("args" in c ? " " + c.args : ""),
                description: c.description,
                source: "Relay",
                Icon: Zap,
              }))
            : []),
          ...(provider !== "message" ? (providerCommands.data ?? []) : [])
            .filter((c) => prefix === "/" || c.source !== "claude")
            .map((c) =>
              c.source === "claude"
                ? {
                    kind: "claude" as const,
                    name: c.name,
                    label:
                      "/" +
                      c.name +
                      (c.argumentHint ? " " + c.argumentHint : ""),
                    description: c.description,
                    source: "Claude",
                    Icon: SquareTerminal,
                  }
                : {
                    kind: "skill" as const,
                    name:
                      prefix === "$" ? c.name.replace(/^skill:/, "") : c.name,
                    label:
                      (prefix === "/" ? "/skill:" : "") +
                      (c.displayName || c.name.replace(/^skill:/, "")),
                    description: c.description,
                    source:
                      {
                        app: "App",
                        repo: "Repo",
                        project: "Project",
                        personal: "Personal",
                        system: "System",
                        claude: "Claude",
                        other: "Provider",
                      }[c.source ?? "other"] + " Skill",
                    Icon: {
                      app: Blocks,
                      repo: Folder,
                      project: Folder,
                      personal: UserRound,
                      system: Settings,
                      claude: Package,
                      other: Package,
                    }[c.source ?? "other"],
                  },
            ),
        ]
  )
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
  function run(command: RelayCommand, args: string) {
    const result = onCommand(command, args);
    if (typeof result === "string") setError(result);
    else if (result) onDraft("");
  }
  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    if (item.kind === "argument") run(argCommand!.name, item.name);
    else if (item.kind === "relay") {
      const command = relayCommands.find((c) => c.name === item.name)!;
      // Required values are picked from the follow-up list.
      if ("args" in command && command.args.startsWith("<"))
        onFill({ start: 0, end: at, text: `/${command.name} ` });
      else run(command.name, "");
    } else if (item.kind === "claude")
      onFill({ start: 0, end: at, text: `/${item.name} ` });
    else
      onSkillPick({
        token: `${prefix}${item.name}`,
        label: item.label.replace(/^\/skill:/, ""),
        start: trigger?.start ?? 0,
        end: trigger?.end ?? draft.length,
      });
  }
  /** Claude runs its own commands when the message starts with one. */
  function claudeCommand(text: string) {
    const name = /^\/([^\s]+)/.exec(text.trim())?.[1];
    return (
      provider === "claude" &&
      !!name &&
      !!providerCommands.data?.some(
        (c) => c.source === "claude" && c.name === name,
      )
    );
  }
  function interceptSend() {
    if (!draft.trim().startsWith("/")) return false;
    const action = relayCommand(draft);
    if (action) {
      run(action.name, action.args);
      return true;
    }
    if (claudeCommand(draft)) return false;
    if (provider === "codex" && /^\/skill:[^\s]+(?:\s|$)/.test(draft.trim()))
      return false;
    setError(
      provider === "claude" && providerCommands.isFetching
        ? "Loading Claude commands… try again in a moment."
        : "Choose a command from the menu. Relay actions run on their own; add instructions after a skill or Claude command.",
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
