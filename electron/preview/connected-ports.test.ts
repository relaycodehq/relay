import { describe, expect, it } from "vitest";
import { lsofConnected, netstatConnected } from "./connected-ports";

describe("connected ports", () => {
  it("reads both ends of lsof's connections, IPv4 and IPv6", () => {
    const out = [
      "p11065",
      "f41",
      "n127.0.0.1:5177->127.0.0.1:59367",
      "p11075",
      "f50",
      "n[::1]:59368->[::1]:3100",
    ].join("\n");
    expect(lsofConnected(out)).toEqual([5177, 59367, 59368, 3100]);
  });

  it("reads netstat's connected rows and skips listeners and closed ones, in any language", () => {
    const out = [
      "  Proto  Local Address          Foreign Address        State           PID",
      "  TCP    0.0.0.0:3100           0.0.0.0:0              LISTENING       812",
      "  TCP    [::]:3100              [::]:0                 ABHÖREN         812",
      "  TCP    127.0.0.1:3100         127.0.0.1:51234        HERGESTELLT     812",
      "  TCP    [::1]:51240            [::1]:3200             ESTABLISHED     944",
      "  TCP    127.0.0.1:51200        127.0.0.1:3300         TIME_WAIT       0",
      "  UDP    0.0.0.0:3100           *:*                                    812",
    ].join("\r\n");
    expect(netstatConnected(out)).toEqual([3100, 51234, 51240, 3200]);
  });
});
