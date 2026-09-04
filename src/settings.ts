// Load/save of settings and run-state, backed by Workers KV.

import type { Env, Settings, AppState } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  canvasBaseUrl: "",
  canvasToken: "",
  notionToken: "",
  notionParentPageId: "",
  notionDatabaseId: "",
  intervalMinutes: 60,
  sync: {
    assignments: true,
    quizzes: true,
    onlyGraded: false,
    includeGrades: true,
    announcements: false,
  },
  courseFilter: [],
};

export const DEFAULT_STATE: AppState = {
  lastSyncAt: null,
  lastRunAt: null,
  lastError: null,
  counts: null,
  log: [],
};

const SETTINGS_KEY = "settings";
const STATE_KEY = "state";

export async function loadSettings(env: Env): Promise<Settings> {
  const raw = (await env.SETTINGS_KV.get(SETTINGS_KEY, "json")) as
    | Partial<Settings>
    | null;
  return {
    ...DEFAULT_SETTINGS,
    ...(raw || {}),
    sync: { ...DEFAULT_SETTINGS.sync, ...(raw?.sync || {}) },
    courseFilter: Array.isArray(raw?.courseFilter) ? raw!.courseFilter! : [],
  };
}

export async function saveSettings(env: Env, s: Settings): Promise<void> {
  await env.SETTINGS_KV.put(SETTINGS_KEY, JSON.stringify(s));
}

export async function loadState(env: Env): Promise<AppState> {
  const raw = (await env.SETTINGS_KV.get(STATE_KEY, "json")) as
    | Partial<AppState>
    | null;
  return { ...DEFAULT_STATE, ...(raw || {}) };
}

export async function saveState(env: Env, st: AppState): Promise<void> {
  await env.SETTINGS_KV.put(STATE_KEY, JSON.stringify(st));
}
