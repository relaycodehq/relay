import { describe, expect, it } from "vitest";
import { linuxPasswordStore } from "../../electron/linux-password-store";

const on = (desktop?: string) =>
  linuxPasswordStore(
    desktop === undefined ? {} : { XDG_CURRENT_DESKTOP: desktop },
  );

describe("linuxPasswordStore", () => {
  it("forces libsecret where Chromium would store basic text", () => {
    expect(on("Hyprland")).toBe("gnome-libsecret");
    expect(on("sway")).toBe("gnome-libsecret");
    expect(on()).toBe("gnome-libsecret");
    expect(on("gnome")).toBe("gnome-libsecret");
  });

  it("leaves desktops Chromium already protects alone", () => {
    expect(on("GNOME")).toBeNull();
    expect(on("ubuntu:GNOME")).toBeNull();
    expect(on("KDE")).toBeNull();
  });

  it("stops at the first desktop Chromium recognises", () => {
    expect(on("LXQt:GNOME")).toBe("gnome-libsecret");
  });
});
