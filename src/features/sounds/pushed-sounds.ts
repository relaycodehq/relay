import { playSound } from "./player";

/** The menubar's hidden player: plays what the main process sends while Relay's window is closed. */
export function playPushedSounds() {
  window.relay.onPlaySound(({ sound, volume, bytes }) => {
    void playSound(sound, volume, async () => {
      if (!bytes) throw new Error("A custom sound came without its file.");
      return bytes;
    }).catch(() => {});
  });
}
