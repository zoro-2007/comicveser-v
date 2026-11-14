# ComicVerse Vercel runtime fixes

This note covers the console issues observed after deploying `apps/web` and `apps/api` as separate Vercel projects.

## 1. Deploy both Vercel projects

Use the same GitHub repository for both projects:

- Frontend project Root Directory: `apps/web`
- Backend project Root Directory: `apps/api`

Frontend Production environment variables:

```env
NEXT_PUBLIC_API_URL=/api
API_INTERNAL_URL=https://comicveser-v-api.vercel.app/api
NEXT_PUBLIC_SITE_URL=https://comicveser-v-two.vercel.app
NEXT_PUBLIC_GOOGLE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
```

Backend Production environment variables:

```env
NODE_ENV=production
DATABASE_URL=YOUR_SUPABASE_POSTGRES_URL
WEB_ORIGIN=https://comicveser-v-two.vercel.app
ALLOW_VERCEL_ORIGINS=true
COOKIE_SAMESITE=none
TRUST_PROXY=1
API_PUBLIC_URL=https://comicveser-v-api.vercel.app/api
GOOGLE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
```

Use the actual production domains if they change. Keep the frontend API base as `/api`; the Next.js rewrite forwards it to `API_INTERNAL_URL`.

## 2. Google Sign-In: allow the frontend origin in Google Cloud

The browser error `The given origin is not allowed for the given client ID` cannot be fixed by changing Vercel code alone.

1. Open Google Cloud Console: https://console.cloud.google.com/apis/credentials
2. Select the OAuth 2.0 Client ID of type **Web application** used by ComicVerse.
3. Under **Authorized JavaScript origins**, add exactly:

   `https://comicveser-v-two.vercel.app`

4. Save the OAuth client.
5. Make sure `GOOGLE_CLIENT_ID` in the API project and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend project contain the same Web Client ID.
6. Redeploy both Vercel projects after updating variables.

For the current popup-based Google Identity Services flow, add the website origin under Authorized JavaScript origins. Do not add a trailing slash. Do not expose a Google client secret in frontend variables.

The frontend component now keeps Google Identity Services initialized once per client ID and routes credential callbacks through the latest React handlers. This addresses the repeated `google.accounts.id.initialize()` warning caused by changing component/context callbacks.

## 3. Analytics event 500

`/api/analytics/event` writes to the Prisma `AnalyticsEvent` table. The API runtime now ensures that table and its indexes exist using idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements during Prisma startup.

If the deployed database role cannot create tables, open Supabase Dashboard -> SQL Editor and run:

`apps/api/prisma/ANALYTICS-SUPABASE-FIX.sql`

Then redeploy the API project. This table is used only for consent-based analytics events; the app should still work when visitors decline analytics.

## 4. Interpreting the other browser messages

- `GET /api/auth/me` returning `401` for a logged-out visitor is expected. It means the session check found no valid login. It should not prevent public pages from loading.
- The font and Google stylesheet CSP messages came from a **report-only** policy, so they were logged but not blocked. The frontend and API CSP report-only directives now explicitly allow Google Fonts and the Google Identity Services stylesheet/font hosts.
- `POST /api/analytics/event` returning `500` was a real server error, unlike the report-only CSP messages.

## 5. Redeploy order and smoke tests

1. Push these project changes to GitHub.
2. Redeploy `comicveser-v-api` first.
3. Verify `https://comicveser-v-api.vercel.app/api/health` returns JSON with `status: "ok"`.
4. Redeploy `comicveser-v-two`.
5. Verify `https://comicveser-v-two.vercel.app/api/health` returns the same health response through the frontend proxy.
6. Test a logged-out homepage, then login, admin access, Google sign-in, and the analytics consent choice.

If the analytics route still returns 500 after this update, inspect the API project's Vercel Runtime Logs for the corresponding request; the log message will identify the remaining database or validation issue.
