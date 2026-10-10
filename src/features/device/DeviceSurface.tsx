import { useCallback, useEffect, useRef } from "react";
import { Smartphone } from "lucide-react";
import type { DeviceHubState } from "../../../shared/devices";
import type { PreviewBounds } from "../../../shared/preview";
import { api } from "../../lib/api";
import { useNativeView } from "../../lib/useNativeView";
import { showDeviceHub, startDeviceHub, useDeviceHub } from "./device-hub";
import "./device.css";

/**
 * The Device tab: Expo's device hub page, which streams the machine's
 * Android Emulators and iOS Simulators. Downloading it waits for a click;
 * once it's there, showing the tab starts it.
 */
export function DeviceSurface({ front }: { front: boolean }) {
  const state = useDeviceHub();
  useEffect(() => {
    if (front) void showDeviceHub();
  }, [front]);
  const viewport = useRef<HTMLDivElement>(null);
  const place = useCallback(
    (bounds: PreviewBounds | null) => void api.placeDeviceView(bounds),
    [],
  );
  // Asleep, the tab still follows where it is: showing it wakes the hub.
  const showPage =
    front && (state?.status === "running" || state?.status === "asleep");
  useNativeView(viewport, showPage, place);
  const waking =
    front && (state?.status === "asleep" || state?.status === "starting");
  const lastFrame = (showPage || waking) && state?.snapshot;
  return (
    <div className="device-surface" ref={viewport}>
      {lastFrame && <img className="device-snapshot" src={lastFrame} alt="" />}
      {!showPage && !lastFrame && <DeviceNotice state={state} />}
    </div>
  );
}

function DeviceNotice({ state }: { state?: DeviceHubState }) {
  if (!state) return <div className="device-notice" />;
  if (state.status === "installing")
    return (
      <div className="device-notice">
        <p>Downloading Expo Device Hub {state.version}…</p>
      </div>
    );
  if (
    state.status === "starting" ||
    state.status === "stopped" ||
    state.status === "asleep"
  )
    return (
      <div className="device-notice">
        <p>Starting the device hub…</p>
      </div>
    );
  if (state.status === "failed")
    return (
      <div className="device-notice" role="alert">
        <p>The device hub didn’t start.</p>
        {state.error && <pre className="device-output">{state.error}</pre>}
        <button type="button" onClick={() => void startDeviceHub()}>
          Try again
        </button>
      </div>
    );
  return (
    <div className="device-notice">
      <Smartphone size={22} />
      <p>Watch and tap your emulators and simulators here.</p>
      <small>
        Relay downloads Expo Device Hub {state.version} with your npm the first
        time, and runs it on this computer, reachable only from Relay. Android
        needs the Android SDK; iOS needs Xcode.
      </small>
      <button type="button" onClick={() => void startDeviceHub()}>
        Download and start
      </button>
    </div>
  );
}
