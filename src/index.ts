// Worker entrypoint: routes the settings UI + API (behind Cloudflare Access)
// and runs the cron-driven sync.

import type { Env, Settings } from "./types";
import { verifyAccess } from "./access";
import {
  loadSettings,
  saveSettings,
  loadState,
} from "./settings";
import { runSync } from "./sync";
import { NotionClient } from "./notion";
import {
  checkPassword,
  makeSessionCookie,
  clearSessionCookie,
  hasValidSession,
} from "./password";
import { renderSettingsPage, renderSetupPage, renderLoginPage } from "./ui";

const MASK = "••••••••";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Return settings with tokens masked so they never round-trip to the browser.
async function getSettings(env: Env): Promise<Response> {
  const s = await loadSettings(env);
  return json({
    ...s,
    canvasToken: s.canvasToken ? MASK : "",
    notionToken: s.notionToken ? MASK : "",
  });
}

async function postSettings(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Partial<Settings>;
  const cur = await loadSettings(env);
  const next: Settings = { ...cur };

  if (typeof body.canvasBaseUrl === "string") {
    next.canvasBaseUrl = body.canvasBaseUrl.trim().replace(/\/+$/, "");
  }
  if (typeof body.notionParentPageId === "string") {
    next.notionParentPageId = body.notionParentPageId.trim();
  }
  // Only overwrite tokens when a real (non-masked, non-empty) value is sent.
  if (body.canvasToken && body.canvasToken !== MASK) {
    next.canvasToken = body.canvasToken.trim();
  }
  if (body.notionToken && body.notionToken !== MASK) {
    next.notionToken = body.notionToken.trim();
  }
  if (body.sync) {
    next.sync = { ...cur.sync, ...body.sync };
  }
  if (body.intervalMinutes != null) {
    next.intervalMinutes = Math.max(15, Number(body.intervalMinutes) || 60);
  }
  if (Array.isArray(body.courseFilter)) {
    next.courseFilter = body.courseFilter
      .map((n) => Number(n))
      .filter((n) => !Number.isNaN(n));
  }

  await saveSettings(env, next);
  return json({ ok: true });
}

async function createNotionDb(env: Env): Promise<Response> {
  const s = await loadSettings(env);
  if (!s.notionToken) return json({ error: "Set the Notion token first" }, 400);
  if (!s.notionParentPageId)
    return json({ error: "Set the Notion parent page ID first" }, 400);

  const notion = new NotionClient(s.notionToken);
  const db = await notion.createDatabase(s.notionParentPageId);
  s.notionDatabaseId = db.id;
  await saveSettings(env, s);
  return json({ ok: true, databaseId: db.id, url: db.url });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const accessConfigured = !!(env.ACCESS_AUD && env.ACCESS_TEAM_DOMAIN);
    const passwordConfigured = !!env.APP_PASSWORD;

    // Nothing configured yet — fail closed with a setup notice.
    if (!accessConfigured && !passwordConfigured) {
      if (url.pathname === "/" && method === "GET") {
        return html(renderSetupPage());
      }
      return json({ error: "Authentication is not configured" }, 503);
    }

    // Password mode: /login and /logout are public (handled before the gate).
    if (!accessConfigured && passwordConfigured) {
      if (url.pathname === "/login" && method === "GET") {
        return html(renderLoginPage(false));
      }
      if (url.pathname === "/login" && method === "POST") {
        const form = await request.formData();
        const pw = String(form.get("password") || "");
        if (await checkPassword(pw, env)) {
          return new Response(null, {
            status: 303,
            headers: { Location: "/", "Set-Cookie": await makeSessionCookie(env) },
          });
        }
        return html(renderLoginPage(true), 401);
      }
      if (url.pathname === "/logout") {
        return new Response(null, {
          status: 303,
          headers: { Location: "/login", "Set-Cookie": clearSessionCookie() },
        });
      }
    }

    // Authentication gate.
    let email = "";
    if (accessConfigured) {
      const access = await verifyAccess(request, env);
      if (!access.ok) {
        return json({ error: "Unauthorized", reason: access.reason }, 401);
      }
      email = access.email || "";
    } else if (!(await hasValidSession(request, env))) {
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "Unauthorized" }, 401);
      }
      return Response.redirect(new URL("/login", url).toString(), 302);
    }

    try {
      if (method === "GET" && url.pathname === "/") {
        return html(renderSettingsPage(email, passwordConfigured));
      }
      if (url.pathname === "/api/settings") {
        if (request.method === "GET") return getSettings(env);
        if (request.method === "POST") return postSettings(request, env);
      }
      if (url.pathname === "/api/status" && request.method === "GET") {
        return json(await loadState(env));
      }
      if (url.pathname === "/api/sync" && request.method === "POST") {
        return json(await runSync(env));
      }
      if (
        url.pathname === "/api/notion/create-db" &&
        request.method === "POST"
      ) {
        return createNotionDb(env);
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 500);
    }
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const settings = await loadSettings(env);
    const state = await loadState(env);

    // Nothing configured yet — skip quietly.
    if (
      !settings.canvasToken ||
      !settings.notionToken ||
      !settings.notionDatabaseId
    ) {
      return;
    }

    const now = Date.now();
    const elapsed = state.lastSyncAt ? now - state.lastSyncAt : Infinity;
    const due = elapsed >= settings.intervalMinutes * 60 * 1000;
    if (!due) return;

    ctx.waitUntil(runSync(env).then(() => undefined));
  },
};
