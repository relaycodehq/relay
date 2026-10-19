import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SshHost } from "../../../shared/handoff";
import { api } from "../../lib/api";

/** How many hosts it offers at once. */
const shown = 6;

const matches = (h: SshHost, typed: string) =>
  [h.host, h.hostName, h.user].some((v) => v?.toLowerCase().includes(typed));

/**
 * The Over SSH host field, offering the hosts in ~/.ssh/config as it's typed
 * in: arrows move through them, Enter or a click connects to one.
 */
export function SshHostInput({
  value,
  onChange,
  onConnect,
  paired,
}: {
  value: string;
  onChange: (value: string) => void;
  onConnect: (host: string) => void;
  /** Already paired over SSH: still offered, but marked. */
  paired: (host: string) => boolean;
}) {
  const hosts = useQuery({
    queryKey: ["ssh-hosts"],
    queryFn: () => api.sshHosts(),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.trim().toLowerCase();
  const offered = open
    ? (hosts.data ?? [])
        .filter((h) => matches(h, typed) && h.host.toLowerCase() !== typed)
        .slice(0, shown)
    : [];
  const pick = (host: string) => {
    onChange(host);
    setOpen(false);
    onConnect(host);
  };
  return (
    <div className="cm-ssh-field">
      <input
        aria-label="SSH host"
        placeholder="user@host, or a Host from ~/.ssh/config"
        spellCheck={false}
        autoComplete="off"
        role="combobox"
        aria-expanded={offered.length > 0}
        aria-controls="cm-ssh-hosts"
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown" && offered.length) {
            e.preventDefault();
            setActive((i) => (i + 1) % offered.length);
          } else if (e.key === "ArrowUp" && offered.length) {
            e.preventDefault();
            setActive((i) => (i <= 0 ? offered.length : i) - 1);
          } else if (e.key === "Escape" && offered.length) {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Enter") {
            const chosen = offered[active]?.host ?? value.trim();
            if (chosen) pick(chosen);
          }
        }}
      />
      {offered.length > 0 && (
        <ul
          id="cm-ssh-hosts"
          className="cm-ssh-hosts"
          role="listbox"
          // Near the bottom of the page it would open out of sight.
          ref={(list) => list?.scrollIntoView({ block: "nearest" })}
        >
          {offered.map((h, i) => (
            <li
              key={h.host}
              role="option"
              aria-selected={i === active}
              // Before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h.host);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <b>{h.host}</b>
              {(h.user || h.hostName) && (
                <small>
                  {h.user && `${h.user}@`}
                  {h.hostName ?? h.host}
                </small>
              )}
              {paired(h.host) && <em>Paired</em>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
