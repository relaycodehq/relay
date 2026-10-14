import { useEffect, useState } from "react";
import { persistedStore } from "../../../lib/persisted-store";

/** The chosen input's deviceId, or "" for the system default. */
const microphone = persistedStore(
  "relay-dictation-mic",
  (saved) => saved ?? "",
  (deviceId) => deviceId || null,
);
export const dictationMicrophone = microphone.get;
export const useDictationMicrophone = microphone.use;
export const setDictationMicrophone = microphone.set;

export interface MicrophoneOption {
  value: string;
  label: string;
}

let known: MediaDeviceInfo[] = [];
const watchers = new Set<() => void>();

/**
 * Asks the system which microphones are plugged in, only while something
 * shows them: listing devices starts Chromium's camera and audio services,
 * ~65MB that then stays for good. The first menu may grow once as they come.
 */
function listMicrophones() {
  void navigator.mediaDevices?.enumerateDevices().then((all) => {
    known = all.filter(
      (d) => d.kind === "audioinput" && d.deviceId !== "default",
    );
    for (const watcher of watchers) watcher();
  });
}

/**
 * The system default plus every microphone plugged in, kept current as they
 * come and go while shown.
 */
export function useMicrophones(): MicrophoneOption[] {
  const [devices, setDevices] = useState(known);
  useEffect(() => {
    const update = () => setDevices(known);
    const changed = () => listMicrophones();
    watchers.add(update);
    listMicrophones();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      watchers.delete(update);
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, []);
  return [
    { value: "", label: "System default" },
    ...devices.map((device, i) => ({
      value: device.deviceId,
      // Names show once the microphone has been allowed.
      label: device.label || `Microphone ${i + 1}`,
    })),
  ];
}
