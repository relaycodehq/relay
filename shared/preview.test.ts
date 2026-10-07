import { describe, expect, it } from "vitest";
import { previewUrl } from "./preview";

describe("previewUrl", () => {
  it("reads local addresses as plain http and the rest as https", () => {
    expect(previewUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(previewUrl(":3000/login")).toBe("http://localhost:3000/login");
    expect(previewUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080/");
    expect(previewUrl("fix-login.relay.localhost:7352")).toBe(
      "http://fix-login.relay.localhost:7352/",
    );
    expect(previewUrl("mac-mini:7352")).toBe("http://mac-mini:7352/");
    expect(previewUrl("192.168.1.20/app")).toBe("http://192.168.1.20/app");
    expect(previewUrl("example.com")).toBe("https://example.com/");
    expect(previewUrl("http://example.com/a")).toBe("http://example.com/a");
  });

  it("refuses what a preview can't load", () => {
    expect(previewUrl("")).toBeNull();
    expect(previewUrl("file:///etc/passwd")).toBeNull();
    expect(previewUrl("javascript:alert(1)")).toBeNull();
  });
});
