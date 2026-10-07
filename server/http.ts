import {
  denyRepositoryAccess,
  repositoryCredentialSchema,
  type RepositoryVerifier,
  type RepositoryIdentity,
} from "./repository-access";
import { SharedWorkspace } from "./workspace";
import { shaSchema } from "../shared/validation";
import { createServer, type IncomingMessage } from "node:http";
import { z } from "zod";
import { landingHtml, landingPolicy } from "./landing";
import { RoomsDatabase, HttpError, hash, type Session } from "./database";
import {
  idSchema,
  secretSchema,
  projectSchema,
  messageInputSchema,
  presenceSchema,
  type Presence,
} from "../shared/rooms";

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[^\x00-\x1f\x7f]+$/);
const createSchema = z
  .object({
    project: projectSchema,
    name: nameSchema,
    sessionToken: secretSchema,
    giteaToken: repositoryCredentialSchema,
  })
  .strict();
const joinSchema = z
  .object({
    projectId: idSchema,
    code: secretSchema,
    project: projectSchema,
    name: nameSchema,
    sessionToken: secretSchema,
    giteaToken: repositoryCredentialSchema,
  })
  .strict();
const updateSchema = z
  .object({
    body: z.string().max(100000),
    status: z.enum(["running", "completed", "failed", "cancelled"]),
    error: z.string().max(1000).nullable(),
  })
  .strict();
const numberSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
async function body(req: IncomingMessage, limit = 200000): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "JSON required.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw new HttpError(413, "Message too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function createRoomsServer(
  database: RoomsDatabase,
  adminSecret: string,
  verifier: RepositoryVerifier = denyRepositoryAccess,
) {
  secretSchema.parse(adminSecret);
  const adminHash = hash(adminSecret);
  const workspace = new SharedWorkspace(database);
  const grants = new Map<string, number>();
  const grant = (
    session: Session,
    identity: RepositoryIdentity,
    initial = false,
  ) => {
    database.bindIdentity(session, identity, initial);
    grants.set(session.id, Date.now() + 60000);
  };
  const presence = new Map<string, Map<string, Presence>>();
  const limits = new Map<string, { at: number; count: number }>();
  const timer = setInterval(() => {
    database.expire();
    for (const [id, expires] of grants)
      if (expires < Date.now()) grants.delete(id);
    for (const [room, people] of presence) {
      for (const [id, p] of people)
        if (p.at < Date.now() - 20000) people.delete(id);
      if (!people.size) presence.delete(room);
    }
    for (const [ip, b] of limits)
      if (b.at < Date.now() - 60000) limits.delete(ip);
  }, 10000);
  timer.unref();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (req.url === "/" && req.method === "GET") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", landingPolicy);
        res.end(landingHtml);
        return;
      }
      // This API is for desktop clients. Browsers get no CORS or cookie authentication.
      if (req.headers.origin)
        throw new HttpError(403, "Browser requests are not accepted.");
      const url = new URL(req.url ?? "/", "http://rooms.local"),
        path = url.pathname,
        method = req.method,
        secret = req.headers.authorization?.replace(/^Bearer /, "") ?? "",
        isAdmin =
          ((path === "/v1/projects" && method === "POST") ||
            (path === "/v1/setup" && method === "GET")) &&
          hash(secret) === adminHash;
      let session: Session | undefined;
      if (secret && !isAdmin) {
        try {
          session = database.authenticate(secret);
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 401)
            throw error;
        }
      }
      // A reverse proxy shares one socket address. Anonymous traffic must not
      // consume signed-in members' allowance. Never trust forwarded IP headers.
      const key = session
        ? `member:${session.id}`
        : isAdmin
          ? "setup"
          : `anonymous:${req.socket.remoteAddress ?? "unknown"}`;
      const now = Date.now();
      let bucket = limits.get(key);
      if (!bucket || now - bucket.at > 60000) {
        bucket = { at: now, count: 0 };
        limits.set(key, bucket);
      }
      if (++bucket.count > 1200)
        throw new HttpError(429, "Too many requests. Retry shortly.");
      let value: unknown;
      if (path === "/health" && method === "GET")
        value = { ok: true, protocol: 2, repositoryAccess: true };
      else if (path === "/v1/setup" && method === "GET") {
        if (!isAdmin) throw new HttpError(401, "Invalid server setup key.");
        value = { ok: true };
      } else if (path === "/v1/projects" && method === "POST") {
        if (!isAdmin) throw new HttpError(401, "Invalid server setup key.");
        const input = createSchema.parse(await body(req));
        const identity = await verifier.verify(input.project, input.giteaToken);
        const session = database.create(
          input.project,
          identity.name,
          input.sessionToken,
        );
        grant(session, identity, true);
        value = {
          projectId: session.projectId,
          project: database.project(session.projectId),
          member: { id: session.id, name: session.name, owner: session.owner },
        };
      } else if (path === "/v1/join" && method === "POST") {
        const input = joinSchema.parse(await body(req));
        const identity = await verifier.verify(input.project, input.giteaToken);
        if (
          JSON.stringify(database.project(input.projectId)) !==
          JSON.stringify(input.project)
        )
          throw new HttpError(
            409,
            "This invitation belongs to a different repository. Open that project first.",
          );
        const session = database.join(
          input.projectId,
          input.code,
          identity.name,
          input.sessionToken,
        );
        grant(session, identity, true);
        value = {
          projectId: session.projectId,
          project: database.project(session.projectId),
          member: { id: session.id, name: session.name, owner: session.owner },
        };
      } else {
        if (!session)
          throw new HttpError(
            401,
            "Room sign-in expired or was revoked. Ask for a new invitation.",
          );
        if (path === "/v1/access" && method === "POST") {
          const input = z
            .object({ giteaToken: repositoryCredentialSchema })
            .strict()
            .parse(await body(req));
          const identity = await verifier.verify(
            database.project(session.projectId),
            input.giteaToken,
          );
          grant(session, identity);
          value = { verified: true, expiresAt: grants.get(session.id) };
        } else {
          if ((grants.get(session.id) ?? 0) <= Date.now())
            throw new HttpError(
              428,
              "Verify current Gitea repository access before opening this project.",
            );
          if (path === "/v1/me" && method === "GET")
            value = {
              projectId: session.projectId,
              project: database.project(session.projectId),
              member: {
                id: session.id,
                name: session.name,
                owner: session.owner,
              },
            };
          else if (path === "/v1/invites" && method === "POST")
            value = database.invite(session);
          else if (path === "/v1/members" && method === "GET")
            value = database.members(session);
          else if (path.startsWith("/v1/members/") && method === "DELETE") {
            database.revoke(session, idSchema.parse(path.slice(12)));
            value = { ok: true };
          } else if (path === "/v1/rooms" && method === "POST") {
            const input = z
              .object({
                number: z.number().int().positive(),
                title: z.string().min(1).max(500),
              })
              .strict()
              .parse(await body(req));
            value = database.open(session, input.number, input.title);
          } else {
            const m =
              /^\/v1\/rooms\/([^/]+)(?:\/(messages|presence|topic|runs|workspace)(?:\/([^/]+))?)?$/.exec(
                path,
              );
            if (!m) throw new HttpError(404, "Endpoint not found.");
            const roomId = idSchema.parse(m[1]);
            database.room(session, roomId);
            const live = () =>
              [...(presence.get(roomId)?.values() ?? [])].filter(
                (p) =>
                  p.at > Date.now() - 20000 &&
                  database.members(session).some((u) => u.id === p.userId),
              );
            if (m[2] === "workspace" && !m[3] && method === "GET")
              value = workspace.manifest(session, roomId);
            else if (m[2] === "workspace" && !m[3] && method === "POST") {
              const input = z
                .object({ base: shaSchema })
                .strict()
                .parse(await body(req));
              value = workspace.open(session, roomId, input.base);
            } else if (
              m[2] === "workspace" &&
              m[3] === "file" &&
              method === "GET"
            )
              value = workspace.read(
                session,
                roomId,
                url.searchParams.get("path") ?? "",
              );
            else if (
              m[2] === "workspace" &&
              m[3] === "file" &&
              method === "PUT"
            )
              value = workspace.write(
                session,
                roomId,
                await body(req, 13 * 1024 * 1024),
              );
            else if (m[2] === "messages" && !m[3] && method === "GET") {
              const after = numberSchema.parse(
                  url.searchParams.get("after") ?? 0,
                ),
                before = url.searchParams.has("before")
                  ? numberSchema.parse(url.searchParams.get("before"))
                  : undefined;
              value = {
                ...database.page(session, roomId, after, before),
                presence: live(),
              };
            } else if (m[2] === "messages" && !m[3] && method === "POST")
              value = database.post(
                session,
                roomId,
                messageInputSchema.parse(await body(req)),
              );
            else if (m[2] === "messages" && m[3] && method === "GET")
              value = database.get(session, roomId, idSchema.parse(m[3]));
            else if (m[2] === "messages" && m[3] && method === "PATCH") {
              // An answer's 100,000 characters can take 600 kB as JSON.
              const input = updateSchema.parse(await body(req, 1024 * 1024));
              value = database.update(
                session,
                roomId,
                idSchema.parse(m[3]),
                input.body,
                input.status,
                input.error,
              );
            } else if (m[2] === "runs" && method === "POST") {
              const input = z
                .object({ requestId: idSchema, model: z.string().max(220) })
                .strict()
                .parse(await body(req));
              value = database.start(
                session,
                roomId,
                input.requestId,
                input.model,
              );
            } else if (m[2] === "topic" && method === "GET")
              value = database.topic(
                session,
                roomId,
                url.searchParams.has("parent")
                  ? idSchema.parse(url.searchParams.get("parent"))
                  : null,
              );
            else if (m[2] === "presence" && method === "GET") value = live();
            else if (m[2] === "presence" && method === "PUT") {
              const input = presenceSchema.nullable().parse(await body(req));
              if (!presence.has(roomId)) presence.set(roomId, new Map());
              if (input)
                presence.get(roomId)!.set(session.id, {
                  ...input,
                  userId: session.id,
                  name: session.name,
                  at: Date.now(),
                });
              else presence.get(roomId)!.delete(session.id);
              value = { ok: true };
            } else throw new HttpError(404, "Endpoint not found.");
          }
        }
      }
      res.end(JSON.stringify(value));
    } catch (e) {
      res.statusCode =
        e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 500;
      res.end(
        JSON.stringify({
          error:
            e instanceof HttpError
              ? e.message
              : e instanceof z.ZodError
                ? "Invalid request fields."
                : "The room server could not complete this request.",
        }),
      );
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 30;
  server.on("close", () => clearInterval(timer));
  return server;
}
