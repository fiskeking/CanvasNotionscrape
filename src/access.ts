// Cloudflare Access JWT verification (defense-in-depth).
//
// When this Worker is placed behind a Cloudflare Access application, every
// request that reaches it carries a signed JWT in the `Cf-Access-Jwt-Assertion`
// header (and a `CF_Authorization` cookie). We verify that token against the
// team's public keys so that even a request hitting the raw workers.dev URL is
// rejected unless it carries a valid Access token for our application.

import type { Env } from "./types";

export interface AccessResult {
  ok: boolean;
  email?: string;
  setup?: boolean; // Access vars not configured yet
  reason?: string;
}

interface JwksCache {
  domain: string;
  fetchedAt: number;
  keys: Record<string, CryptoKey>;
}

let jwksCache: JwksCache | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

function b64urlToBytes(input: string): Uint8Array {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(input: string): string {
  return new TextDecoder().decode(b64urlToBytes(input));
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function getSigningKey(
  teamDomain: string,
  kid: string,
): Promise<CryptoKey | null> {
  const base = teamDomain.startsWith("http")
    ? teamDomain
    : `https://${teamDomain}`;
  const stale =
    !jwksCache ||
    jwksCache.domain !== teamDomain ||
    Date.now() - jwksCache.fetchedAt > JWKS_TTL_MS;

  if (stale) {
    const res = await fetch(`${base}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys: Record<string, CryptoKey> = {};
    for (const jwk of body.keys || []) {
      if (!jwk.kid) continue;
      try {
        keys[jwk.kid] = await crypto.subtle.importKey(
          "jwk",
          jwk,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
      } catch {
        // skip keys that fail to import
      }
    }
    jwksCache = { domain: teamDomain, fetchedAt: Date.now(), keys };
  }
  return jwksCache!.keys[kid] || null;
}

export async function verifyAccess(
  request: Request,
  env: Env,
): Promise<AccessResult> {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) {
    return { ok: false, setup: true };
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    readCookie(request, "CF_Authorization");
  if (!token) return { ok: false, reason: "Missing Cloudflare Access token" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "Malformed token" };

  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; email?: string };
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch {
    return { ok: false, reason: "Unparseable token" };
  }

  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return { ok: false, reason: "Token expired" };
  }

  const auds = Array.isArray(payload.aud)
    ? payload.aud
    : payload.aud
      ? [payload.aud]
      : [];
  if (!auds.includes(env.ACCESS_AUD)) {
    return { ok: false, reason: "Audience (aud) mismatch" };
  }

  if (!header.kid) return { ok: false, reason: "No key id in token" };
  const key = await getSigningKey(env.ACCESS_TEAM_DOMAIN, header.kid);
  if (!key) return { ok: false, reason: "Unknown signing key" };

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    sig,
    data,
  );
  if (!valid) return { ok: false, reason: "Bad signature" };

  return { ok: true, email: payload.email };
}
