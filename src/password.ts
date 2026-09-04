// Simple password gate for deployments that can't use Cloudflare Access
// (e.g. no custom domain). The password is stored as the Worker secret
// APP_PASSWORD. A successful login sets a signed, expiring session cookie.

import type { Env } from "./types";

const COOKIE = "cns_session";
const MAX_AGE_SEC = 60 * 60 * 12; // 12 hours

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(keyStr: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(msg),
  );
  return toHex(sig);
}

async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

// Constant-time compare of two equal-length hex strings.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD || !input) return false;
  // Compare hashes so the comparison length doesn't leak the real length.
  const a = await sha256Hex(input);
  const b = await sha256Hex(env.APP_PASSWORD);
  return timingSafeEqual(a, b);
}

export async function makeSessionCookie(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const sig = await hmacHex(env.APP_PASSWORD!, `v1.${exp}`);
  return `${COOKIE}=${exp}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SEC}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function hasValidSession(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  const cookieHeader = request.headers.get("Cookie") || "";
  let value: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) {
      value = v.join("=");
      break;
    }
  }
  if (!value) return false;

  const dot = value.lastIndexOf(".");
  if (dot < 0) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expNum = Number(exp);
  if (!expNum || Math.floor(Date.now() / 1000) > expNum) return false;

  const expected = await hmacHex(env.APP_PASSWORD, `v1.${exp}`);
  return timingSafeEqual(sig, expected);
}
