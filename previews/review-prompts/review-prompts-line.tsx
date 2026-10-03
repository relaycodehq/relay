// A reviewer's prompt as a line you type into, like the composer: `/` for
// commands, `$` for Codex skills, anything else is your own prompt.
import { useState, type ReactNode } from "react";
import { PenLine, ScanSearch, SquareTerminal, Zap } from "lucide-react";
import { agentName } from "../../shared/agents";
import {
  catalog,
  customPrompts,
  nativeCommand,
  nativeLabel,
  parsePrompt,
  type Reviewer,
  type SetupStore,
} from "./review-prompts-data";

type Suggestion = {
  prompt: string;
  fill: string;
  label: string;
  detail?: string;
  icon: ReactNode;
};

export function PromptLine({
  store,
  reviewer,
  index,
  onChange,
}: {
  store: SetupStore;
  reviewer: Reviewer;
  index: number;
  onChange: (prompt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Until you type, the menu lists everything rather than filtering by what's there.
  const [browsing, setBrowsing] = useState(true);
  const { provider, prompt } = reviewer;
  const text = prompt.trim();
  const kind = parsePrompt(provider, prompt).kind;
  const iconOf = (p: string) => {
    const k = parsePrompt(provider, p).kind;
    return k === "native" ? (
      <ScanSearch size={14} />
    ) : k === "skill" ? (
      <Zap size={14} />
    ) : k === "command" ? (
      <SquareTerminal size={14} />
    ) : (
      <PenLine size={14} />
    );
  };
  // What you ran with this agent before, newest first.
  const recent = [
    ...new Set(
      store.saved.flatMap((s) =>
        s.setup.reviewers
          .filter((r) => r.provider === provider)
          .map((r) => r.prompt.trim()),
      ),
    ),
  ];
  const filter = browsing ? "" : text;
  const typingToken = /^[/$]\S*$/.test(filter);
  const q = filter.toLowerCase();
  const groups: [string, Suggestion[]][] = [];
  if (!filter) {
    groups.push([
      `Recent with ${agentName(provider)}`,
      recent.slice(0, 4).map((p) => ({
        prompt: p,
        fill: p,
        label: p || nativeLabel(provider),
        detail:
          parsePrompt(provider, p).kind === "native"
            ? "its own review"
            : undefined,
        icon: iconOf(p),
      })),
    ]);
  }
  if (!filter || typingToken) {
    // While browsing, what Recent already lists isn't repeated.
    const listed = filter ? [] : recent.slice(0, 4);
    const items = catalog[provider].filter(
      (i) => i.token.startsWith(filter) && !listed.includes(i.token),
    );
    groups.push([
      "Commands and skills",
      [
        ...(nativeCommand(provider) &&
        nativeCommand(provider).startsWith(filter) &&
        !listed.includes(nativeCommand(provider))
          ? [
              {
                prompt: nativeCommand(provider),
                fill: `${nativeCommand(provider)} `,
                label: nativeLabel(provider),
                detail: "its own review",
                icon: <ScanSearch size={14} />,
              },
            ]
          : []),
        ...items.map((i) => ({
          prompt: i.token,
          fill: `${i.token} `,
          label: i.token,
          detail: i.description,
          icon:
            i.kind === "skill" ? (
              <Zap size={14} />
            ) : (
              <SquareTerminal size={14} />
            ),
        })),
      ],
    ]);
  } else if (kind === "custom") {
    groups.push([
      "Your prompts",
      customPrompts(store.saved)
        .filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q)
        .slice(0, 4)
        .map((p) => ({
          prompt: p,
          fill: p,
          label: p,
          icon: <PenLine size={14} />,
        })),
    ]);
  }
  const shown = groups.filter(([, items]) => items.length);
  const flat = shown.flatMap(([, items]) => items);
  const menu = open && flat.length > 0;
  const pick = (s: Suggestion) => {
    onChange(s.fill);
    setActive(0);
    setBrowsing(true);
    // A command stays open for instructions after it.
    if (!s.fill.endsWith(" ")) setOpen(false);
  };
  let n = -1;
  return (
    <div className="rp-line" data-kind={kind}>
      {iconOf(prompt)}
      <textarea
        rows={1}
        aria-label={`Prompt for reviewer ${index + 1}`}
        spellCheck={false}
        placeholder={`${nativeLabel(provider)} · or type / for commands${provider === "codex" ? ", $ for skills" : ""}, or your own prompt`}
        value={prompt}
        onFocus={(e) => {
          setOpen(true);
          setBrowsing(true);
          // A bare command is replaced by typing; End keeps it to add instructions.
          if (/^[/$]\S+$/.test(text)) e.target.select();
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value.replace(/\n/g, " "));
          setActive(0);
          setBrowsing(false);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && menu) {
            e.preventDefault();
            setOpen(false);
          } else if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive(
              (a) =>
                (a + (e.key === "ArrowDown" ? 1 : flat.length - 1)) %
                flat.length,
            );
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (menu) pick(flat[active]!);
          }
        }}
      />
      {menu && (
        <div className="composer-command-menu rp-suggest" role="listbox">
          {shown.map(([title, items]) => (
            <div key={title}>
              <div className="composer-menu-label">{title}</div>
              {items.map((s) => {
                n += 1;
                const i = n;
                return (
                  <button
                    key={title + s.prompt}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "selected" : ""}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(s)}
                  >
                    {s.icon}
                    <strong className={/^[/$]/.test(s.label) ? "rp-mono" : ""}>
                      {s.label}
                    </strong>
                    {s.detail && <small>{s.detail}</small>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
