import type { PreviewBounds } from "./preview";

/**
 * The device hub: Expo's expo-device-hub, which streams iOS Simulators and
 * Android Emulators to a web page. Relay installs it on request and runs it
 * on loopback, behind a token.
 */
export type DeviceHubStatus =
  /** Not downloaded yet; nothing happens until someone asks. */
  | "absent"
  /** Downloaded, not running. */
  | "stopped"
  | "installing"
  | "starting"
  | "running"
  | "failed";

export interface DeviceHubState {
  status: DeviceHubStatus;
  version: string;
  error?: string;
  /** The page's last frame, shown while something covers the view. */
  snapshot?: string;
  /** What the machine can run: an Android SDK, and Xcode on a Mac. */
  platforms: { android: boolean; ios: boolean };
}

export interface DevicesApi {
  deviceHub(): Promise<DeviceHubState>;
  /** Downloads the hub the first time, then starts it. */
  startDeviceHub(): Promise<DeviceHubState>;
  /** Where the panel shows the hub, in the page's CSS pixels; null takes it off. */
  placeDeviceView(bounds: PreviewBounds | null): Promise<void>;
  /** The Device tab closed: the page goes, the hub and its devices keep running. */
  closeDeviceView(): Promise<void>;
  onDeviceHub(callback: (state: DeviceHubState) => void): () => void;
}
