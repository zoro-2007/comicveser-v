# Deploying ComicVerse on Vercel

ComicVerse is pre-configured to deploy on Vercel either from the **repository root (`.`)** or with **Root Directory set to `apps/web`** (and optionally `apps/api` as a separate Vercel serverless project).

## Option 1 (Recommended): Web App on Vercel + API on Render

Hosting the Next.js web app (`apps/web`) on Vercel with the built-in `/api` proxy means the browser talks only to your `.vercel.app` domain (eliminating cross-site cookie blocking and Render IP range blocks).

1. **Import into Vercel**:
   - Open [vercel.com/new](https://vercel.com/new) and import your GitHub repository (or upload the project).
   - **Root Directory**: You can either leave it at the repository root (`.` — handled automatically by the root `vercel.json`) or set it to `apps/web` (handled by `apps/web/vercel.json`).
   - **Framework Preset**: Next.js (auto-detected).

2. **Configure Vercel Environment Variables (Production & Preview)**:
   - `NEXT_PUBLIC_API_URL` = `/api`
   - `API_INTERNAL_URL` = `https://<your-api-service>.onrender.com/api` *(even if you omit `/api`, `next.config.mjs` and `src/lib/api.ts` normalize it automatically)*
   - `NEXT_PUBLIC_SITE_URL` = `https://<your-project>.vercel.app` *(optional — auto-detected from `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` if omitted)*
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = `<your-google-oauth-client-id>` *(optional, if using Google Sign-In)*

3. **Deploy on Vercel**:
   - Click **Deploy**. Your app will be live at `https://<your-project>.vercel.app`.

4. **Update Render API Environment Variables**:
   - In your Render `comicverse-api` service, set:
     - `WEB_ORIGIN` = `https://<your-project>.vercel.app` *(comma-separated if keeping additional origins; Vercel preview URLs `https://<your-project>-*.vercel.app` are allowed automatically)*
     - `ALLOW_VERCEL_ORIGINS` = `true`

## Option 2: Deploying the Backend API (`apps/api`) on Vercel Serverless

If you also want to host the NestJS API on Vercel instead of Render:

1. Create a second project in Vercel and import the same repository.
2. Set **Root Directory** to `apps/api` (uses `apps/api/vercel.json` and the serverless handler at `apps/api/api/index.js`).
3. Set Environment Variables on the Vercel API project:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = `<your-postgresql-connection-string>`
   - `WEB_ORIGIN` = `https://<your-web-project>.vercel.app`
   - `ALLOW_VERCEL_ORIGINS` = `true`
   - `COOKIE_SAMESITE` = `none`
   - `TRUST_PROXY` = `1`
4. Set `API_INTERNAL_URL` on your Vercel Web project to `https://<your-api-project>.vercel.app/api`.
