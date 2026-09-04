// Sync orchestration: read Canvas per the configured toggles, then upsert into
// the Notion database. Shared by the manual "Sync now" endpoint and the cron.

import type { Env, Settings, SyncItem, AppState, SyncCounts } from "./types";
import {
  CanvasClient,
  type CanvasAssignment,
  type CanvasAnnouncement,
} from "./canvas";
import { NotionClient } from "./notion";
import { loadSettings, loadState, saveState } from "./settings";

export interface SyncResult {
  ok: boolean;
  counts?: SyncCounts;
  error?: string;
  log: string[];
}

function mapAssignment(
  a: CanvasAssignment,
  courseName: string,
  settings: Settings,
): SyncItem[] {
  const isQuiz =
    !!a.quiz_id || (a.submission_types || []).includes("online_quiz");
  const type = isQuiz ? "Quiz" : "Assignment";

  if (type === "Quiz" && !settings.sync.quizzes) return [];
  if (type === "Assignment" && !settings.sync.assignments) return [];

  const points = a.points_possible ?? null;
  if (settings.sync.onlyGraded && !(points && points > 0)) return [];

  let status = "Not started";
  let grade: number | null = null;
  const sub = a.submission;
  if (sub) {
    switch (sub.workflow_state) {
      case "graded":
        status = "Graded";
        break;
      case "submitted":
      case "pending_review":
        status = "Submitted";
        break;
      default:
        status = "Not started";
    }
    if (
      settings.sync.includeGrades &&
      sub.workflow_state === "graded" &&
      sub.score != null
    ) {
      grade = sub.score;
    }
  }
  if (
    status === "Not started" &&
    a.due_at &&
    new Date(a.due_at).getTime() < Date.now()
  ) {
    status = "Missing";
  }

  return [
    {
      key: `assignment-${a.id}`,
      name: a.name || "(untitled)",
      course: courseName,
      type,
      due: a.due_at || null,
      points,
      status,
      grade,
      url: a.html_url || "",
    },
  ];
}

function mapAnnouncement(
  an: CanvasAnnouncement,
  courseName: string,
): SyncItem | null {
  if (!an || !an.id) return null;
  return {
    key: `announcement-${an.id}`,
    name: an.title || "(announcement)",
    course: courseName,
    type: "Announcement",
    due: an.posted_at || an.created_at || null,
    points: null,
    status: "Posted",
    grade: null,
    url: an.html_url || "",
  };
}

function trimLog(state: AppState, log: string[]): void {
  state.log = log.slice(-40);
}

export async function runSync(env: Env): Promise<SyncResult> {
  const settings = await loadSettings(env);
  const state = await loadState(env);
  const log: string[] = [];
  const push = (m: string) => log.push(`${new Date().toISOString()}  ${m}`);

  state.lastRunAt = Date.now();

  try {
    if (!settings.canvasBaseUrl) throw new Error("Canvas base URL not set");
    if (!settings.canvasToken) throw new Error("Canvas token not set");
    if (!settings.notionToken) throw new Error("Notion token not set");
    if (!settings.notionDatabaseId)
      throw new Error("Notion database not created yet");

    const canvas = new CanvasClient(
      settings.canvasBaseUrl,
      settings.canvasToken,
    );
    const notion = new NotionClient(settings.notionToken);

    push("Fetching active Canvas courses…");
    let courses = await canvas.getActiveCourses();
    if (settings.courseFilter.length) {
      courses = courses.filter((c) => settings.courseFilter.includes(c.id));
    }
    push(`Found ${courses.length} course(s).`);

    const items: SyncItem[] = [];
    for (const c of courses) {
      if (settings.sync.assignments || settings.sync.quizzes) {
        const assignments = await canvas.getAssignments(
          c.id,
          settings.sync.includeGrades,
        );
        for (const a of assignments) {
          items.push(...mapAssignment(a, c.name, settings));
        }
      }
      if (settings.sync.announcements) {
        const anns = await canvas.getAnnouncements(c.id);
        for (const an of anns) {
          const it = mapAnnouncement(an, c.name);
          if (it) items.push(it);
        }
      }
    }
    push(`Prepared ${items.length} item(s) to sync.`);

    push("Loading existing Notion pages…");
    const existing = await notion.queryAllPages(settings.notionDatabaseId);
    const byKey = new Map(existing.map((p) => [p.key, p.id]));

    let created = 0;
    let updated = 0;
    for (const it of items) {
      const pageId = byKey.get(it.key);
      if (pageId) {
        await notion.updatePage(pageId, it);
        updated++;
      } else {
        await notion.createPage(settings.notionDatabaseId, it);
        created++;
      }
    }
    push(`Done. Created ${created}, updated ${updated}.`);

    state.lastSyncAt = Date.now();
    state.lastError = null;
    state.counts = { created, updated, total: items.length };
    trimLog(state, log);
    await saveState(env, state);
    return { ok: true, counts: state.counts, log };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    push(`ERROR: ${msg}`);
    state.lastError = msg;
    trimLog(state, log);
    await saveState(env, state);
    return { ok: false, error: msg, log };
  }
}
