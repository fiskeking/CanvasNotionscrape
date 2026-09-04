// Minimal Notion API client: create the database, query existing pages for
// dedup, and create/update pages.

import type { SyncItem } from "./types";

const NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com/v1";

// Database schema created by createDatabase(). "Canvas ID" is the dedup key.
const DATABASE_SCHEMA = {
  Name: { title: {} },
  Course: { select: {} },
  Type: {
    select: {
      options: [
        { name: "Assignment" },
        { name: "Quiz" },
        { name: "Announcement" },
      ],
    },
  },
  Due: { date: {} },
  Points: { number: {} },
  Status: {
    select: {
      options: [
        { name: "Not started" },
        { name: "Submitted" },
        { name: "Graded" },
        { name: "Missing" },
        { name: "Posted" },
      ],
    },
  },
  Grade: { number: {} },
  "Canvas ID": { rich_text: {} },
  "Canvas Link": { url: {} },
};

// Notion select option names cannot contain commas and are length-limited.
function sanitizeSelect(value: string): string {
  return (value || "").replace(/,/g, " ").trim().slice(0, 100);
}

// Accept a bare id, a dashed UUID, or a full Notion URL and pull the id out.
function normalizeId(input: string): string {
  const s = (input || "").trim();
  const dashed = s.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  if (dashed) return dashed[0];
  const compact = s.match(/[0-9a-fA-F]{32}/);
  if (compact) return compact[0];
  return s;
}

function itemToProperties(item: SyncItem): Record<string, unknown> {
  return {
    Name: {
      title: [{ text: { content: (item.name || "(untitled)").slice(0, 2000) } }],
    },
    Type: { select: { name: item.type } },
    Course: item.course
      ? { select: { name: sanitizeSelect(item.course) } }
      : { select: null },
    Due: item.due ? { date: { start: item.due } } : { date: null },
    Points: item.points != null ? { number: item.points } : { number: null },
    Status: item.status ? { select: { name: item.status } } : { select: null },
    Grade: item.grade != null ? { number: item.grade } : { number: null },
    "Canvas ID": { rich_text: [{ text: { content: item.key } }] },
    "Canvas Link": item.url ? { url: item.url } : { url: null },
  };
}

function extractCanvasKey(page: {
  properties?: Record<string, { rich_text?: { plain_text: string }[] }>;
}): string | null {
  const rt = page?.properties?.["Canvas ID"]?.rich_text;
  if (Array.isArray(rt) && rt.length) {
    return rt.map((r) => r.plain_text).join("");
  }
  return null;
}

export class NotionClient {
  constructor(private token: string) {}

  private async api(
    path: string,
    method: string,
    body?: unknown,
  ): Promise<any> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Notion ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  async createDatabase(
    parentPageId: string,
  ): Promise<{ id: string; url: string }> {
    const db = await this.api("/databases", "POST", {
      parent: { type: "page_id", page_id: normalizeId(parentPageId) },
      title: [{ type: "text", text: { content: "Canvas Assignments" } }],
      properties: DATABASE_SCHEMA,
    });
    return { id: db.id, url: db.url };
  }

  // Read every page, returning its dedup key so the sync can upsert.
  async queryAllPages(
    databaseId: string,
  ): Promise<{ id: string; key: string }[]> {
    const out: { id: string; key: string }[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const res = await this.api(
        `/databases/${normalizeId(databaseId)}/query`,
        "POST",
        body,
      );
      for (const p of res.results || []) {
        const key = extractCanvasKey(p);
        if (key) out.push({ id: p.id, key });
      }
      cursor = res.has_more ? res.next_cursor : undefined;
      pages++;
    } while (cursor && pages < 50);
    return out;
  }

  async createPage(databaseId: string, item: SyncItem): Promise<void> {
    await this.api("/pages", "POST", {
      parent: { database_id: normalizeId(databaseId) },
      properties: itemToProperties(item),
    });
  }

  async updatePage(pageId: string, item: SyncItem): Promise<void> {
    await this.api(`/pages/${pageId}`, "PATCH", {
      properties: itemToProperties(item),
    });
  }
}
