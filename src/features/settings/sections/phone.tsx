import type { SettingEntry } from "../settings-search";
import { PhoneRemoteSettings } from "../../handoff/PhoneRemoteSettings";
import { useSavedSetting } from "../useSavedSetting";
import { api } from "../../../lib/api";
import { Switch } from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";

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
    {
      id: "keep-awake",
      category: "phone",
      title: "Keep this computer awake",
      description:
        "So agents keep working and a phone can still reach it after you walk away. Plugged in, it never idles to sleep while Relay runs; on battery, only while an agent works or a phone is paired, and not under 20%. The screen still turns off and locks, and closing the lid still sleeps it.",
      keywords:
        "sleep awake caffeinate idle power battery plugged lid screen lock reachable",
      render: () => <KeepAwakeSwitch />,
    },
  ];
}

function KeepAwakeSwitch() {
  const keepAwake = useSavedSetting(
    { queryKey: ["keep-awake"], queryFn: () => api.keepAwake() },
    (enabled) => api.saveKeepAwake(enabled),
    ["keep-awake"],
  );
  return (
    <>
      <Switch
        label="Keep this computer awake"
        checked={keepAwake.value ?? true}
        disabled={!keepAwake.loaded || keepAwake.saving}
        onChange={(enabled) => keepAwake.set(enabled)}
      />
      {keepAwake.error && <ErrorBox error={keepAwake.error} />}
    </>
  );
}
