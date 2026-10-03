import type { SettingEntry } from "../settings-search";
import { PhoneRemoteSettings } from "../../handoff/PhoneRemoteSettings";

export function phoneEntries(): SettingEntry[] {
  return [
    {
      id: "phone-remote",
      category: "phone",
      title: "Phone access",
      description:
        "Pair a phone to see what your agents are doing, answer their questions and send messages while you're away from the desk.",
      keywords: "phone mobile android remote qr pair tailscale",
      block: true,
      render: () => <PhoneRemoteSettings />,
    },
  ];
}
