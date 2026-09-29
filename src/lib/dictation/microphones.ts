import { useEffect, useState, useSyncExternalStore } from "react";

const MIC_KEY = "relay-dictation-mic";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The chosen input's deviceId, or "" for the system default. */
export const dictationMicrophone = () => localStorage.getItem(MIC_KEY) ?? "";
export const useDictationMicrophone = () =>
  useSyncExternalStore(subscribe, dictationMicrophone);

export function setDictationMicrophone(deviceId: string) {
  if (deviceId) localStorage.setItem(MIC_KEY, deviceId);
  else localStorage.removeItem(MIC_KEY);
  for (const listener of listeners) listener();
}

export interface MicrophoneOption {
  value: string;
  label: string;
}

/**
 * The system default plus every microphone plugged in, kept current as they
 * come and go.
 */
export function useMicrophones(): MicrophoneOption[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const list = () =>
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((all) =>
          setDevices(
            all.filter(
              (d) => d.kind === "audioinput" && d.deviceId !== "default",
            ),
          ),
        );
    list();
    navigator.mediaDevices?.addEventListener("devicechange", list);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", list);
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
