// Minimal Canvas LMS REST API client (token auth, Link-header pagination).

export interface CanvasCourse {
  id: number;
  name: string;
}

export interface CanvasSubmission {
  score: number | null;
  workflow_state: string; // "unsubmitted" | "submitted" | "graded" | "pending_review" | ...
  submitted_at: string | null;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  html_url: string;
  quiz_id: number | null;
  submission_types?: string[];
  submission?: CanvasSubmission;
}

export interface CanvasAnnouncement {
  id: number;
  title: string;
  html_url: string;
  posted_at: string | null;
  created_at: string | null;
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

export class CanvasClient {
  private baseUrl: string;

  constructor(
    baseUrl: string,
    private token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async getRaw(
    pathOrUrl: string,
  ): Promise<{ data: unknown; nextUrl: string | null }> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Canvas ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
      );
    }
    const nextUrl = parseNextLink(res.headers.get("Link"));
    const data = await res.json();
    return { data, nextUrl };
  }

  // Follow rel="next" links up to `maxPages` to keep subrequests bounded.
  private async paginate<T>(path: string, maxPages = 10): Promise<T[]> {
    let out: T[] = [];
    let next: string | null = path;
    let pages = 0;
    while (next && pages < maxPages) {
      const { data, nextUrl } = await this.getRaw(next);
      if (Array.isArray(data)) out = out.concat(data as T[]);
      else break;
      next = nextUrl;
      pages++;
    }
    return out;
  }

  async getActiveCourses(): Promise<CanvasCourse[]> {
    const courses = await this.paginate<Record<string, unknown>>(
      "/api/v1/courses?enrollment_state=active&per_page=100",
    );
    return courses
      .filter((c) => c && c.id && !c.access_restricted_by_date)
      .map((c) => ({
        id: c.id as number,
        name: (c.name as string) || `Course ${c.id}`,
      }));
  }

  async getAssignments(
    courseId: number,
    includeSubmission: boolean,
  ): Promise<CanvasAssignment[]> {
    const inc = includeSubmission ? "&include[]=submission" : "";
    return this.paginate<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments?per_page=100${inc}`,
    );
  }

  async getAnnouncements(courseId: number): Promise<CanvasAnnouncement[]> {
    return this.paginate<CanvasAnnouncement>(
      `/api/v1/announcements?context_codes[]=course_${courseId}&per_page=50`,
    );
  }
}
