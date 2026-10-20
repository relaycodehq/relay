import { Monitor, SquareTerminal, X } from "lucide-react";
import type { ComputerRoute } from "../../../shared/handoff";
import type { Target } from "./add-targets";

type RouteTarget = Extract<Target, { kind: "route" }>;

export function RouteIcon({
  route,
  size = 12,
}: {
  route: ComputerRoute;
  size?: number;
}) {
  const Icon = route.kind === "ssh" ? SquareTerminal : Monitor;
  return <Icon size={size} aria-hidden />;
}

const groups = [
  { kind: "wsl", label: "On this computer" },
  { kind: "ssh", label: "From ~/.ssh/config" },
] as const;

/**
 * Everything Add could reach, by where it came from, narrowed by what's
 * typed. It opens in place of the hint row, so the page doesn't jump.
 */
export function HostList({
  list,
  hidden,
  typed,
  active,
  onActive,
  onPick,
  onClose,
}: {
  /** In the order the groups show them, as the arrows move through them. */
  list: RouteTarget[];
  /** How many are left out as paired already. */
  hidden: number;
  typed: string;
  active: number;
  onActive: (index: number) => void;
  onPick: (target: RouteTarget) => void;
  onClose: () => void;
}) {
  const shown = groups
    .map((g) => ({
      ...g,
      items: list.flatMap((t, i) =>
        t.route.kind === g.kind ? [{ t, i }] : [],
      ),
    }))
    .filter((g) => g.items.length);
  return (
    <div className="cm-host-list">
      <button
        type="button"
        className="cm-host-close"
        aria-label="Close the list"
        title="Close (Esc)"
        onClick={onClose}
      >
        <X size={13} aria-hidden />
      </button>
      <div
        className="cm-host-scroll"
        role="listbox"
        aria-label="Computers to add"
      >
        {shown.map((g) => (
          <section key={g.kind} role="group" aria-label={g.label}>
            <div className="cm-host-label">
              {g.label}
              <span>{g.items.length}</span>
            </div>
            <div className="cm-host-grid">
              {g.items.map(({ t, i }) => (
                <button
                  key={t.name}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  title={`${t.name} · ${t.detail}`}
                  onMouseEnter={() => onActive(i)}
                  onClick={() => onPick(t)}
                >
                  <RouteIcon route={t.route} />
                  <b>{t.name}</b>
                  <small>{t.detail}</small>
                </button>
              ))}
            </div>
          </section>
        ))}
        {!shown.length && (
          <p className="cm-host-none">
            Nothing here goes by that name; Check tries{" "}
            <code>ssh {typed.replace(/^ssh\s+/, "")}</code>.
          </p>
        )}
        {!!hidden && (
          <p className="cm-host-hidden">
            {hidden} paired already {hidden === 1 ? "isn't" : "aren't"} listed.
          </p>
        )}
      </div>
    </div>
  );
}
