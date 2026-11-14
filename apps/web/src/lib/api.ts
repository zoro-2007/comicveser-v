function normalizeApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      if (u.pathname === "" || u.pathname === "/") {
        u.pathname = "/api";
      }
      return u.toString().replace(/\/+$/, "");
    } catch {
      return trimmed;
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const configuredPublicApi = process.env.NEXT_PUBLIC_API_URL
  ? normalizeApiBase(process.env.NEXT_PUBLIC_API_URL)
  : "";

export const API = (
  configuredPublicApi ||
  (typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? "/api"
    : process.env.VERCEL
    ? "/api"
    : "http://localhost:4000/api")
).replace(/\/+$/, "");

export const UNAUTHORIZED_EVENT = "cv:unauthorized";

const SESSION_TOKEN_KEY = "cv_session_token";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    else window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore storage quota or private mode restrictions
  }
}

export function clearSessionToken(): void {
  setSessionToken(null);
}

export function buildAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(extra)) {
      for (const [k, v] of extra) headers[k] = v;
    } else {
      Object.assign(headers, extra);
    }
  }
  const token = getSessionToken();
  if (token && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

const serverBase = () => {
  if (typeof window === "undefined") {
    const internal =
      process.env.API_INTERNAL_URL ||
      process.env.BACKEND_URL ||
      process.env.API_URL;
    if (internal) {
      return normalizeApiBase(internal);
    }
    if (/^https?:\/\//i.test(API)) {
      return API;
    }
    const siteOrigin = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      `http://localhost:${process.env.PORT || 4000}`
    ).replace(/\/+$/, "");
    return `${siteOrigin}${API.startsWith("/") ? API : `/${API}`}`;
  }
  return API;
};

export async function api<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  const hasJsonBody = json !== undefined || (!isFormData && rest.body !== undefined);
  const baseHeaders: HeadersInit = {
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
    ...(rest.headers || {}),
  };
  const headers = buildAuthHeaders(baseHeaders);

  const controller = !rest.signal && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 15_000) : null;
  let res: Response;
  try {
    res = await fetch(`${serverBase()}${normalizedPath}`, {
      ...rest,
      signal: rest.signal ?? controller?.signal,
      credentials: rest.credentials ?? "include",
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      ...((rest as any).next ? {} : { cache: rest.cache ?? "no-store" }),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && normalizedPath !== "/auth/me" && typeof window !== "undefined") {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const rawMsg = body?.error?.message ?? body?.message;
    const message = Array.isArray(rawMsg)
      ? rawMsg.join(", ")
      : rawMsg ?? `Request failed (${res.status})`;
    const details = Array.isArray(body?.error?.details)
      ? body.error.details
      : Array.isArray(rawMsg)
      ? rawMsg
      : undefined;
    throw new ApiError(res.status, message, details);
  }
  return body as T;
}
