import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const tokens = {
  input: 10,
  output: 3,
  reasoning: 2,
  cache: { read: 4, write: 1 },
};
const model = { providerID: "opencode", id: "big-pickle" };

/** A native v2 service; ACP remains a separate stdio client, as in the installed CLI. */
export async function openCodeNativeFixture() {
  const calls: {
    method: string;
    path: string;
    query: Record<string, string>;
    body: any;
    authorization?: string;
  }[] = [];
  const sessions = new Map<string, any>();
  const messages = new Map<string, any[]>();
  const logs = new Map<string, any[]>();
  const forms = new Map<string, any>();
  const active = new Set<string>();
  const inbox = new Map<string, any>();
  const subscribers = new Set<ServerResponse>();
  const waiting = new Map<string, () => void>();
  const permits = new Map<string, number>();
  const wake = (id: string) => {
    const waitingNow = waiting.get(id);
    if (waitingNow) {
      waiting.delete(id);
      waitingNow();
    } else permits.set(id, (permits.get(id) ?? 0) + 1);
  };
  const controls = {
    password: "fixture-local-password",
    deliver: true,
    lostPromptReply: false,
    failCancel: false,
    failRead: false,
    rejectReply: false,
    failRemove: false,
    authUrl: "",
    watchReply: "learn: none",
  };
  let eventId = 0;
  const emit = (
    type: string,
    data: any,
    durable = type.startsWith("session.") && type !== "session.idle",
  ) => {
    const list = logs.get(data.sessionID) ?? [];
    const event = {
      id: `evt_${++eventId}`,
      created: Date.now(),
      type,
      data,
      ...(durable
        ? {
            durable: {
              aggregateID: data.sessionID,
              seq: list.length + 1,
              version: 1,
            },
          }
        : {}),
    };
    if (durable) {
      list.push(event);
      logs.set(data.sessionID, list);
    }
    for (const res of subscribers)
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    return event;
  };
  const create = (id: string, more: object = {}) => {
    if (sessions.has(id)) return sessions.get(id);
    const session = {
      id,
      projectID: "prj_fixture",
      location: { directory: "/fixture" },
      model,
      tokens,
      cost: 0,
      time: { created: Date.now(), updated: Date.now() },
      ...more,
    };
    sessions.set(id, session);
    messages.set(id, []);
    emit("session.created", { ...session, sessionID: id });
    return session;
  };
  const finish = (sessionID: string, text = "Native answer.") => {
    const list = messages.get(sessionID)!;
    const id = `msg_answer_${list.length}`;
    list.push({
      type: "assistant",
      id,
      agent: "build",
      model,
      content: [{ type: "text", text }],
      time: { created: Date.now(), completed: Date.now() },
      tokens,
      cost: 0.03,
    });
    emit("session.step.started", {
      sessionID,
      assistantMessageID: id,
      model,
      agent: "build",
      started: Date.now(),
    });
    emit("session.text.ended", {
      sessionID,
      assistantMessageID: id,
      ordinal: 0,
      text,
    });
    emit("session.step.ended", {
      sessionID,
      assistantMessageID: id,
      finish: "stop",
      tokens,
      cost: 0.03,
    });
    emit("session.execution.succeeded", { sessionID });
    active.delete(sessionID);
    sessions.get(sessionID).outcome = "succeeded";
    emit("session.idle", { sessionID }, false);
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      const path = url.pathname;
      calls.push({
        method: req.method!,
        path,
        query: Object.fromEntries(url.searchParams),
        body,
        authorization: req.headers.authorization,
      });
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      const empty = () => {
        res.writeHead(204);
        res.end();
      };
      if (path.startsWith("/fixture/")) {
        if (path === "/fixture/session") {
          create(body.id, body);
          return json({});
        }
        if (path === "/fixture/turn") {
          create(body.sessionID);
          active.add(body.sessionID);
          messages
            .get(body.sessionID)!
            .push({
              type: "user",
              id: `msg_user_${messages.get(body.sessionID)!.length}`,
              text: "ACP prompt",
              time: { created: Date.now() },
            });
          emit("session.execution.started", { sessionID: body.sessionID });
          return json({});
        }
        if (path === "/fixture/end") {
          finish(body.sessionID, body.text);
          return json({});
        }
        if (path === "/fixture/event") {
          emit(
            body.type,
            { ...body.data, sessionID: body.data?.sessionID ?? body.sessionID },
            body.durable,
          );
          return json({});
        }
        if (path === "/fixture/release") {
          wake(body.sessionID);
          return json({});
        }
        if (path === "/fixture/wait") {
          if (permits.get(body.sessionID)) {
            permits.set(body.sessionID, permits.get(body.sessionID)! - 1);
            return json({});
          }
          waiting.set(body.sessionID, () => json({}));
          return;
        }
      }
      if (
        req.headers.authorization !==
        "Basic " +
          Buffer.from(`opencode:${controls.password}`).toString("base64")
      )
        return json({ _tag: "UnauthorizedError" }, 401);
      if (controls.failRead && req.method === "GET" && path !== "/api/event")
        return json({ error: "should-not-leak" }, 503);
      if (path.startsWith("/api/integration") && controls.authUrl) {
        const forwarded = await fetch(controls.authUrl + path + url.search, {
          method: req.method,
          headers: {
            authorization: req.headers.authorization!,
            "content-type": "application/json",
          },
          ...(text ? { body: text } : {}),
        });
        res.writeHead(forwarded.status, Object.fromEntries(forwarded.headers));
        res.end(await forwarded.text());
        return;
      }
      if (path === "/api/event") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        subscribers.add(res);
        res.write(
          `data: ${JSON.stringify({ type: "server.connected", id: "evt_connected", data: {} })}\n\n`,
        );
        req.on("close", () => subscribers.delete(res));
        return;
      }
      if (path === "/api/session/active")
        return json({
          data: Object.fromEntries(
            [...active].map((id) => [id, { type: "running" }]),
          ),
        });
      if (path === "/api/session" && req.method === "POST")
        return json({ data: create(`ses_temporary_${sessions.size}`, body) });
      if (path === "/api/session" && req.method === "GET")
        return json({
          data: [...sessions.values()].filter(
            (s) => s.parentID === url.searchParams.get("parentID"),
          ),
          cursor: {},
        });
      if (path === "/api/location/reload") return empty();
      if (path === "/api/experimental/generate")
        return json({ data: { text: "A helpful commit message" } });
      if (path === "/api/model")
        return json({
          location: { directory: "/fixture" },
          data: [
            {
              ...model,
              variants: [{ id: "low" }, { id: "high" }, { id: "default" }],
            },
          ],
        });
      const match = /^\/api\/(?:experimental\/)?session\/([^/]+)(.*)$/.exec(
        path,
      );
      if (!match) return json({ _tag: "InvalidRequestError" }, 404);
      const sessionID = decodeURIComponent(match[1]),
        rest = match[2];
      if (!sessions.has(sessionID)) create(sessionID);
      if (!rest && req.method === "DELETE") {
        if (controls.failRemove) return json({}, 503);
        sessions.delete(sessionID);
        messages.delete(sessionID);
        return empty();
      }
      if (!rest) return json({ data: sessions.get(sessionID) });
      if (rest === "/wait") return empty();
      if (rest === "/context") return json({ data: messages.get(sessionID) });
      if (rest === "/log") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of logs.get(sessionID) ?? [])
          if (event.durable.seq > Number(url.searchParams.get("after") ?? 0))
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        res.end(
          `data: ${JSON.stringify({ type: "log.synced", aggregateID: sessionID, seq: logs.get(sessionID)?.length ?? 0 })}\n\n`,
        );
        return;
      }
      const message = /^\/message\/([^/]+)$/.exec(rest);
      if (message) {
        const found = messages.get(sessionID)!.find((m) => m.id === message[1]);
        return found ? json({ data: found }) : json({}, 404);
      }
      if (rest === "/message") {
        const list = [...messages.get(sessionID)!];
        if (url.searchParams.get("order") === "desc") list.reverse();
        return json({
          data: list.slice(0, Number(url.searchParams.get("limit") ?? 100)),
          cursor: {},
        });
      }
      if (rest === "/fork") {
        const id = `ses_fork_${sessions.size}`;
        const next = create(id, {
          location: sessions.get(sessionID).location,
          parentID: sessionID,
          fork: {
            sessionID,
            boundary: { type: "before", messageID: body.before },
          },
        });
        const list = messages.get(sessionID)!;
        messages.set(
          id,
          body.before
            ? list.slice(
                0,
                list.findIndex((m) => m.id === body.before),
              )
            : [...list],
        );
        return json({ data: next });
      }
      if (rest === "/generate")
        return json({
          data: {
            text: body.prompt.includes("learn: none")
              ? controls.watchReply
              : "An answer beside the thread",
          },
        });
      if (rest === "/move") {
        sessions.get(sessionID).location = { directory: body.directory };
        return empty();
      }
      if (rest === "/model") {
        sessions.get(sessionID).model = body.model;
        return empty();
      }
      if (rest === "/interrupt") {
        active.delete(sessionID);
        emit("session.execution.interrupted", { sessionID, reason: "user" });
        return json({ data: { interrupted: true } });
      }
      if (rest === "/prompt") {
        inbox.set(body.id, { ...body, id: body.id, sessionID });
        if (body.resume !== false) active.add(sessionID);
        if (controls.deliver && active.has(sessionID)) {
          inbox.delete(body.id);
          messages
            .get(sessionID)!
            .push({
              id: body.id,
              type: "user",
              text: body.text,
              time: { created: Date.now() },
            });
          emit("session.inbox.delivered", { sessionID, inboxID: body.id });
          wake(sessionID);
        }
        if (body.resume !== false) finish(sessionID, "An image helper answer");
        if (controls.lostPromptReply) {
          res.destroy();
          return;
        }
        return json({
          data: {
            id: body.id,
            sessionID,
            type: "user",
            payload: { text: body.text },
            delivery: body.delivery,
            time: { created: Date.now() },
          },
        });
      }
      if (rest === "/inbox")
        return json({
          data: [...inbox.values()].filter((i) => i.sessionID === sessionID),
        });
      const pending = /^\/inbox\/([^/]+)$/.exec(rest);
      if (pending && req.method === "DELETE") {
        if (controls.failCancel) return json({}, 503);
        inbox.delete(pending[1]);
        return empty();
      }
      if (rest === "/form")
        return json({
          data: [...forms.values()]
            .filter(
              (f) => f.sessionID === sessionID && f.state.status === "pending",
            )
            .map(({ state, ...form }) => form),
        });
      const form = /^\/form\/([^/]+)(.*)$/.exec(rest);
      if (form) {
        const found = forms.get(form[1]);
        if (!found) return json({}, 404);
        if (form[2] === "/reply") {
          if (controls.rejectReply) return json({ _tag: "FormInvalid" }, 400);
          found.state = { status: "answered", answer: body.answer };
          emit("form.replied", { id: found.id, sessionID }, false);
          wake(sessionID);
          return empty();
        }
        if (req.method === "DELETE") {
          found.state = { status: "cancelled" };
          emit("form.cancelled", { id: found.id, sessionID }, false);
          return empty();
        }
        return json({ data: found });
      }
      json({}, 404);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    sessions,
    messages,
    logs,
    active,
    forms,
    inbox,
    controls,
    emit,
    create,
    finish,
    disconnect: () => {
      for (const res of subscribers) res.destroy();
      subscribers.clear();
    },
    close: async () => {
      for (const res of subscribers) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
