// Settings → Phone as it walks through Tailscale, one sample state at a time.
// Open http://127.0.0.1:5177/previews/phone-tailscale.html
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/features/settings/settings.css";
import { initAppearance } from "../../src/lib/appearance";
import { PhoneRemoteSettings } from "../../src/features/handoff/PhoneRemoteSettings";
import type { PhoneRemoteState, PhoneTailnet } from "../../shared/remote";
import type { Api } from "../../shared/types";

initAppearance();

const tailnet: PhoneTailnet = {
  status: "connected",
  addresses: ["100.64.12.34"],
  name: "Studio Mac",
  phones: [{ name: "Z Fold7", online: false }],
};
const fold = {
  id: "7c1e2b3a-0000-4000-8000-000000000001",
  name: "Galaxy Z Fold7",
  created: Date.now() - 86_400_000,
  lastSeen: Date.now() - 600_000,
  online: false,
};
const base = { error: undefined, port: 47821, hosts: [], devices: [] };
const states: Record<string, PhoneRemoteState> = {
  "No Tailscale": {
    ...base,
    enabled: false,
    listening: false,
    tailnet: { status: "missing", addresses: [] },
  },
  "Tailscale off": {
    ...base,
    enabled: false,
    listening: false,
    tailnet: { status: "stopped", addresses: [] },
  },
  Ready: { ...base, enabled: false, listening: false, tailnet },
  "On, phone offline": {
    ...base,
    enabled: true,
    listening: true,
    hosts: ["100.64.12.34"],
    tailnet,
  },
  "On, phone online": {
    ...base,
    enabled: true,
    listening: true,
    hosts: ["100.64.12.34"],
    tailnet: { ...tailnet, phones: [{ name: "Z Fold7", online: true }] },
  },
  "On, no CLI": {
    ...base,
    enabled: true,
    listening: true,
    hosts: ["100.64.12.34"],
    tailnet: { status: "connected", addresses: ["100.64.12.34"] },
  },
  Paired: {
    ...base,
    enabled: true,
    listening: true,
    hosts: ["100.64.12.34"],
    tailnet: { ...tailnet, phones: [{ name: "Z Fold7", online: true }] },
    devices: [{ ...fold, online: true }],
  },
  "Waiting for Tailscale": {
    ...base,
    enabled: true,
    listening: false,
    tailnet: { status: "stopped", addresses: [] },
    devices: [fold],
  },
};

let current = "No Tailscale";
const queryClient = new QueryClient();
Object.assign(window.relay as Partial<Api>, {
  phoneRemoteState: async () => states[current]!,
  setPhoneRemote: async (enabled: boolean) => {
    current = enabled ? "On, phone offline" : "Ready";
    return states[current]!;
  },
  phonePairing: async () => ({
    url: "relay-remote://pair?h=100.64.12.34&p=47821&k=sample&c=sample&n=Studio+Mac",
    expiresAt: Date.now() + 600_000,
  }),
  revokePhone: async () => states[current]!,
  openExternal: async (url: string) => console.log("open", url),
  writeClipboard: async () => {},
});

function Preview() {
  const [state, setState] = useState(current);
  return (
    <div
      className="settings-content"
      style={{ maxWidth: 720, margin: "0 auto" }}
    >
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data.{" "}
        {Object.keys(states).map((name) => (
          <button
            key={name}
            aria-pressed={name === state}
            style={{ marginRight: 6, fontWeight: name === state ? 600 : 400 }}
            onClick={() => {
              current = name;
              setState(name);
              void queryClient.invalidateQueries();
            }}
          >
            {name}
          </button>
        ))}
      </p>
      <h3 style={{ margin: "18px 0 10px" }}>Phone access</h3>
      <PhoneRemoteSettings />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
