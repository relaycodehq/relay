import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Autocomplete } from "@base-ui/react/autocomplete";
import type { SshHost } from "../../../shared/handoff";
import { api } from "../../lib/api";

const matches = (h: SshHost, query: string) => {
  const typed = query.trim().toLowerCase();
  return [h.host, h.hostName, h.user].some((v) =>
    v?.toLowerCase().includes(typed),
  );
};

/**
 * The Over SSH host field, offering the hosts in ~/.ssh/config as it's typed
 * in: arrows move through them, Enter or a click connects to one, and Enter
 * on what's typed connects to that.
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
  const highlighted = useRef<SshHost>(undefined);
  return (
    <Autocomplete.Root
      items={hosts.data ?? []}
      value={value}
      onValueChange={(next, details) => {
        onChange(next);
        if (details.reason === "item-press") onConnect(next);
      }}
      onItemHighlighted={(h) => (highlighted.current = h)}
      itemToStringValue={(h: SshHost) => h.host}
      filter={matches}
      limit={6}
      openOnInputClick
    >
      <Autocomplete.Input
        aria-label="SSH host"
        placeholder="user@host, or a Host from ~/.ssh/config"
        spellCheck={false}
        onKeyDown={(e) => {
          // A highlighted host connects as a pick; this is what's typed.
          if (
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            !highlighted.current &&
            value.trim()
          )
            onConnect(value);
        }}
      />
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start">
          <Autocomplete.Popup className="cm-ssh-hosts">
            <Autocomplete.List>
              {(h: SshHost) => (
                <Autocomplete.Item key={h.host} value={h}>
                  <b>{h.host}</b>
                  {(h.user || h.hostName) && (
                    <small>
                      {h.user && `${h.user}@`}
                      {h.hostName ?? h.host}
                    </small>
                  )}
                  {paired(h.host) && <em>Paired</em>}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
