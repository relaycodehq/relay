// A deep reviewer's prompt as a line you type into, like the composer: `/`
// for the agent's commands, `$` for Codex skills, anything else your own.
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { PenLine, ScanSearch, SquareTerminal, Zap } from "lucide-react";
import { agentName, agents } from "../../shared/agents";
import {
  ownReviewCommand,
  reviewerPrompt,
  type ReviewAgent,
} from "../../shared/deep-review";
import { api } from "../lib/api";
import { useReviewSetups, writtenPrompts } from "../lib/review-setups";

type Suggestion = {
  /** What the line becomes; a trailing space leaves room for a note. */
  fill: string;
  label: string;
  detail?: string;
  icon: ReactNode;
};
type Kind = "own" | "command" | "skill" | "custom";

const kindOf = (provider: ReviewAgent["provider"], prompt: string): Kind =>
  reviewerPrompt(provider, prompt).kind === "own"
    ? "own"
    : /^\$/.test(prompt.trim())
      ? "skill"
      : /^\//.test(prompt.trim())
        ? "command"
        : "custom";
const icons: Record<Kind, ReactNode> = {
  own: <ScanSearch size={13} />,
  command: <SquareTerminal size={13} />,
  skill: <Zap size={13} />,
  custom: <PenLine size={13} />,
};

export function ReviewPromptLine({
  projectId,
  provider,
  value,
  label,
  onChange,
}: {
  projectId: string;
  provider: ReviewAgent["provider"];
  value: string;
  label: string;
  onChange: (prompt: string) => void;
}) {
  const id = useId();
  const line = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Until you type, the menu lists everything rather than filtering by what's there.
  const [browsing, setBrowsing] = useState(true);
  const { entries } = useReviewSetups();
  const own = ownReviewCommand(provider);
  const skills = agents[provider].skills;
  const commands = useQuery({
    queryKey: ["provider-commands", projectId, provider],
    queryFn: () => api.projectCommands(projectId, provider),
    enabled: open,
    staleTime: 60000,
    retry: false,
  });
  const text = value.trim();
  const filter = browsing ? "" : text;
  const token = /^[/$]\S*$/.test(filter);
  const suggest = (prompt: string, detail?: string): Suggestion => {
    const kind = kindOf(provider, prompt);
    return {
      fill: prompt,
      label: prompt || agents[provider].reviewCommand,
      detail: kind === "own" ? "its own review" : detail,
      icon: icons[kind],
    };
  };
  const groups: [string, Suggestion[]][] = [];
  const recent = filter
    ? []
    : [
        ...new Set(
          entries.flatMap((e) =>
            e.setup.reviewers
              .filter((r) => r.provider === provider)
              .map((r) => r.prompt?.trim() || own),
          ),
        ),
      ].slice(0, 4);
  if (recent.length)
    groups.push([
      `Recent with ${agentName(provider)}`,
      recent.map((p) => suggest(p)),
    ]);
  if (!filter || token) {
    const listed = (commands.data ?? []).map((c) => {
      const name = skills ? c.name.replace(/^skill:/, "") : c.name;
      return {
        token: `${skills ? "$" : "/"}${name}`,
        description: c.description,
      };
    });
    const all = [
      ...(own ? [{ token: own, description: "" }] : []),
      ...listed.filter((c) => c.token !== own),
    ];
    groups.push([
      skills ? "Its review and skills" : "Commands",
      all
        .filter((c) => c.token.startsWith(filter) && !recent.includes(c.token))
        .slice(0, 40)
        .map((c) => ({
          ...suggest(c.token, c.description),
          fill: `${c.token} `,
        })),
    ]);
  } else if (kindOf(provider, text) === "custom") {
    const q = text.toLowerCase();
    groups.push([
      "Your prompts",
      writtenPrompts()
        .filter((p) => p.toLowerCase().includes(q) && p.toLowerCase() !== q)
        .slice(0, 4)
        .map((p) => suggest(p)),
    ]);
  }
  const shown = groups.filter(([, items]) => items.length);
  const flat = shown.flatMap(([, items]) => items);
  const menu = open && flat.length > 0;
  const pick = (s: Suggestion) => {
    onChange(s.fill);
    setActive(0);
    setBrowsing(true);
    // A command stays open for a note after it.
    if (!s.fill.endsWith(" ")) setOpen(false);
  };
  const [bounds, setBounds] = useState({
    left: 0,
    top: 0,
    width: 420,
    above: true,
  });
  useLayoutEffect(() => {
    if (!menu) return;
    // Portaled and fixed, like the composer's menu: the composer clips overflow.
    function measure() {
      const box = line.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, 340), 440, innerWidth - 24);
      const above = box.top > 320 || box.top > innerHeight - box.bottom;
      setBounds({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        top: above ? box.top - 4 : box.bottom + 4,
        width,
        above,
      });
    }
    measure();
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => {
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure, true);
    };
  }, [menu]);
  let n = -1;
  return (
    <div
      className="deep-review-prompt"
      ref={line}
      data-kind={kindOf(provider, value)}
    >
      {icons[kindOf(provider, value)]}
      <textarea
        rows={1}
        aria-label={label}
        aria-expanded={menu}
        aria-controls={menu ? id : undefined}
        spellCheck={false}
        maxLength={2000}
        placeholder={`${agents[provider].reviewCommand} · or type /${skills ? " or $" : ""} for more, or your own prompt`}
        value={value}
        onFocus={(e) => {
          setOpen(true);
          setBrowsing(true);
          // A bare command is replaced by typing; End keeps it to add a note.
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
            e.stopPropagation();
            setOpen(false);
          } else if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setActive(
              (a) =>
                (a + (e.key === "ArrowDown" ? 1 : flat.length - 1)) %
                flat.length,
            );
          } else if (e.key === "Enter") {
            // Enter never sends from here; it picks, or does nothing.
            e.preventDefault();
            if (menu) pick(flat[active % flat.length]!);
          }
        }}
      />
      {menu &&
        createPortal(
          <div
            id={id}
            role="listbox"
            aria-label={`${agentName(provider)} prompts`}
            className="composer-command-menu deep-review-prompt-menu"
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              transform: bounds.above ? "translateY(-100%)" : undefined,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {shown.map(([title, items]) => (
              <div key={title} role="group" aria-label={title}>
                <div className="composer-menu-label">{title}</div>
                {items.map((s) => {
                  n += 1;
                  const i = n;
                  return (
                    <button
                      key={title + s.fill}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === active}
                      className={i === active ? "selected" : ""}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(s)}
                    >
                      {s.icon}
                      <strong className={/^[/$]/.test(s.label) ? "mono" : ""}>
                        {s.label}
                      </strong>
                      {s.detail && <small>{s.detail}</small>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
