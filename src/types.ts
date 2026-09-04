// Shared types for the Canvas → Notion sync Worker.

export interface Env {
  SETTINGS_KV: KVNamespace;
  // Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com".
  ACCESS_TEAM_DOMAIN?: string;
  // Cloudflare Access application Audience (AUD) tag.
  ACCESS_AUD?: string;
}

export interface SyncToggles {
  assignments: boolean; // sync regular assignments
  quizzes: boolean; // sync quizzes (assignments backed by a Canvas quiz)
  onlyGraded: boolean; // only items with points_possible > 0
  includeGrades: boolean; // fetch submission + write your score
  announcements: boolean; // also mirror course announcements
}

export interface Settings {
  canvasBaseUrl: string; // e.g. https://school.instructure.com
  canvasToken: string;
  notionToken: string;
  notionParentPageId: string; // page the database is created under
  notionDatabaseId: string; // filled in once the database is created
  intervalMinutes: number; // desired auto-sync interval (>= 15)
  sync: SyncToggles;
  courseFilter: number[]; // empty = all active courses
}

export type ItemType = "Assignment" | "Quiz" | "Announcement";

export interface SyncItem {
  key: string; // stable dedup key, e.g. "assignment-123"
  name: string;
  course: string;
  type: ItemType;
  due: string | null; // ISO 8601
  points: number | null;
  status: string;
  grade: number | null;
  url: string;
}

export interface SyncCounts {
  created: number;
  updated: number;
  total: number;
}

export interface AppState {
  lastSyncAt: number | null; // last successful sync (epoch ms)
  lastRunAt: number | null; // last attempt (epoch ms)
  lastError: string | null;
  counts: SyncCounts | null;
  log: string[];
}
