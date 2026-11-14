# Deploying ComicVerse: `apps/web` on Vercel + `apps/api` on Render

- **Frontend (`apps/web`)**: Hosted on **Vercel**. All browser `/api/*` requests are proxied server-to-server by `apps/web/src/app/api/[...path]/route.ts` to your Render API, avoiding cross-site cookie issues and Render IP blocks.
- **Backend (`apps/api`)**: Hosted on **Render** using `render.yaml` (runs NestJS, Prisma migrations, and background chapter sync jobs).

## 1. Deploy the Backend (`apps/api`) on Render
1. In Render Dashboard, create a **Web Service** from your GitHub repo (or use **Blueprint** with `render.yaml`).
   - **Root Directory**: `apps/api`
   - **Build Command**: `npm install --include=dev && npx prisma generate && npm run build && node scripts/resolve-migrations.js`
   - **Start Command**: `npm run start:prod`
2. Set Environment Variables on Render:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = `<your-postgres-url>`
   - `WEB_ORIGIN` = `https://<your-project>.vercel.app`
   - `ALLOW_VERCEL_ORIGINS` = `true`
   - `COOKIE_SAMESITE` = `none`
   - `TRUST_PROXY` = `1`
   - `GOOGLE_CLIENT_ID` = `<your-google-oauth-client-id>` *(optional)*
   - `MAIL_PROVIDER` = `resend`, `RESEND_API_KEY`, `MAIL_FROM` *(optional)*
3. Copy your Render URL (e.g. `https://comicverse-api.onrender.com`).

## 2. Deploy the Frontend (`apps/web`) on Vercel
1. Open [vercel.com/new](https://vercel.com/new) and import your GitHub repository.
   - **Root Directory**: `.` (uses root `vercel.json`) or `apps/web` (uses `apps/web/vercel.json`).
   - **Framework Preset**: Next.js (auto-detected).
2. Set Environment Variables on Vercel:
   - `NEXT_PUBLIC_API_URL` = `/api`
   - `API_INTERNAL_URL` = `https://<your-render-api>.onrender.com/api`
   - `NEXT_PUBLIC_SITE_URL` = `https://<your-project>.vercel.app`
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` = `<your-google-oauth-client-id>` *(optional)*
3. Click **Deploy**.
