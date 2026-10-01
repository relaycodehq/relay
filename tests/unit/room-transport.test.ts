import { describe, it, expect, vi } from "vitest";
import { roomRequest, type Network } from "../../electron/rooms/transport";

const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

function server(...responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: Network = async (url, init) => {
    calls.push({ url, init: init! });
    return responses.shift()!;
  };
  return { fetcher, calls };
}

describe("roomRequest", () => {
  it("sends the session token and a JSON body only when given, and refuses redirects", async () => {
    const { fetcher, calls } = server(reply(200, { ok: 1 }), reply(200, []));
    const request = roomRequest(fetcher, async () => false);
    await expect(
      request("https://rooms.test", "/v1/invites", "token", "POST", {}),
    ).resolves.toEqual({ ok: 1 });
    await request("https://rooms.test", "/health", undefined);
    expect(calls[0].url).toBe("https://rooms.test/v1/invites");
    expect(calls[0].init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: "{}",
      redirect: "error",
    });
    expect(calls[1].init.method).toBe("GET");
    expect(calls[1].init.headers).toEqual({});
    expect(calls[1].init).not.toHaveProperty("body");
  });

  it("proves access again once after a 428 and repeats the call, without looping", async () => {
    const { fetcher, calls } = server(
      reply(428, { error: "Access check expired." }),
      reply(428, { error: "Access check expired." }),
    );
    const reauth = vi.fn(async () => true);
    const request = roomRequest(fetcher, reauth);
    await expect(
      request("https://rooms.test", "/v1/members", "token"),
    ).rejects.toThrow("Access check expired.");
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(reauth).toHaveBeenCalledWith("token");
    expect(calls).toHaveLength(2);
  });

  it("does not repeat a 428 when there is no session token or access cannot be proven", async () => {
    const { fetcher, calls } = server(
      reply(428, { error: "No." }),
      reply(428, { error: "No." }),
    );
    const reauth = vi.fn(async () => false);
    const request = roomRequest(fetcher, reauth);
    await expect(
      request("https://rooms.test", "/a", undefined),
    ).rejects.toThrow("No.");
    expect(reauth).not.toHaveBeenCalled();
    await expect(request("https://rooms.test", "/a", "token")).rejects.toThrow(
      "No.",
    );
    expect(reauth).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it("names the failure from the server's error, its status, or an unreadable body", async () => {
    const { fetcher } = server(
      reply(400, { error: "x".repeat(2000) }),
      reply(503, { message: "busy" }),
      reply(200, "<html>proxy</html>"),
    );
    const request = roomRequest(fetcher, async () => false);
    const long = await request("https://rooms.test", "/a", "t").catch(
      (e: Error) => e.message,
    );
    expect(long).toBe("x".repeat(1000));
    await expect(request("https://rooms.test", "/a", "t")).rejects.toThrow(
      "Room server returned 503.",
    );
    await expect(request("https://rooms.test", "/a", "t")).rejects.toThrow(
      "The room server returned an invalid response.",
    );
  });
});
