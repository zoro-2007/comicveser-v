import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function resolveBackendBase(): string {
  const candidates = [
    process.env.API_INTERNAL_URL,
    process.env.BACKEND_URL,
    process.env.API_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(trimmed)) continue;
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
  return "";
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxyRequest(
  req: NextRequest,
  context: { params: { path?: string[] } | Promise<{ path?: string[] }> },
) {
  const backendBase = resolveBackendBase();
  if (!backendBase) {
    return NextResponse.json(
      {
        error: {
          message:
            "API_INTERNAL_URL is not configured on Vercel. Set API_INTERNAL_URL=https://<your-api>.onrender.com/api in Vercel Environment Variables and redeploy.",
        },
      },
      { status: 503 },
    );
  }

  const resolvedParams = await context.params;
  const segments = resolvedParams?.path ?? [];
  const targetPath = segments.map((s) => encodeURIComponent(s)).join("/");
  const search = req.nextUrl.search || "";
  const targetUrl = `${backendBase}/${targetPath}${search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  if (!headers.has("x-forwarded-host") && req.headers.get("host")) {
    headers.set("x-forwarded-host", req.headers.get("host")!);
  }
  if (!headers.has("x-forwarded-proto")) {
    headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", "") || "https");
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const bodyBuffer = hasBody ? await req.arrayBuffer() : undefined;

  const attemptFetch = async (timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(targetUrl, {
        method,
        headers,
        body: bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : undefined,
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;

  // Retry once on transient cold-start / gateway errors (e.g. Render waking up)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      upstream = await attemptFetch(attempt === 0 ? 25_000 : 30_000);
      if (attempt === 0 && (upstream.status === 502 || upstream.status === 503 || upstream.status === 504)) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break;
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  if (!upstream) {
    const msg =
      lastError instanceof Error && lastError.name === "AbortError"
        ? "The backend API timed out while waking up. Please refresh in a few seconds."
        : "Unable to reach the backend API server.";
    return NextResponse.json({ error: { message: msg } }, { status: 504 });
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && lower !== "content-encoding") {
      resHeaders.append(key, value);
    }
  });

  // Preserve multiple Set-Cookie headers if present
  const getSetCookie = (upstream.headers as any).getSetCookie;
  if (typeof getSetCookie === "function") {
    const cookies: string[] = getSetCookie.call(upstream.headers);
    if (cookies.length > 0) {
      resHeaders.delete("set-cookie");
      for (const c of cookies) {
        resHeaders.append("set-cookie", c);
      }
    }
  }

  if (upstream.status === 204 || upstream.status === 304) {
    return new NextResponse(null, { status: upstream.status, headers: resHeaders });
  }

  const resBody = await upstream.arrayBuffer();
  return new NextResponse(resBody, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export async function GET(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function POST(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function PUT(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function PATCH(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function DELETE(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function OPTIONS(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
export async function HEAD(req: NextRequest, ctx: any) {
  return proxyRequest(req, ctx);
}
