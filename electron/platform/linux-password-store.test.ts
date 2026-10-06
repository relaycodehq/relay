import { describe, expect, it } from "vitest";
import { linuxPasswordStore } from "./linux-password-store";

const storeFor = (desktop?: string) =>
  linuxPasswordStore(
    desktop === undefined ? {} : { XDG_CURRENT_DESKTOP: desktop },
  );

describe("linuxPasswordStore", () => {
  it.each<{ desktop?: string; why: string }>([
    { desktop: "Hyprland", why: "a compositor Chromium doesn't know" },
    { desktop: "sway", why: "a lowercase compositor name" },
    { why: "no desktop named at all" },
    { desktop: "gnome", why: "GNOME in the wrong case" },
    { desktop: "LXQt:GNOME", why: "LXQt named ahead of a keyring desktop" },
  ])("asks for libsecret given $why", ({ desktop }) => {
    expect(storeFor(desktop)).toBe("gnome-libsecret");
  });

  it.each(["GNOME", "KDE", "ubuntu:GNOME"])(
    "keeps Chromium's own keyring on %s",
    (desktop) => {
      expect(storeFor(desktop)).toBeNull();
    },
  );
});
