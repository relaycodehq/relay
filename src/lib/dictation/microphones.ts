import { useEffect, useState } from "react";
import { persistedStore } from "../persisted-store";

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
