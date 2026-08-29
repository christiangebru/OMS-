# Clothing Order Management System

Production-oriented monorepo:

- **client** — React 18, Vite, TypeScript, Tailwind CSS, PWA (installable), Recharts
- **server** — Node.js, Express, PostgreSQL (Prisma), JWT, bcrypt, Multer (image uploads)

## Prerequisites

- Node.js 18+
- PostgreSQL database (local, or Neon in production) and a `DATABASE_URL`

## 1. Backend (local)

```bash
cd server
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, CORS_ORIGIN (http://localhost:5173), API_PUBLIC_URL (http://localhost:4000)
npm install                  # runs `prisma generate` via postinstall
npm run db:migrate:deploy    # apply migrations to the database
npm run seed                 # base reference data (clothing types)
npm run seed:demo            # optional: demo customers, staff, orders
npm run dev
```

Bootstrap the first **admin** user via `POST /api/auth/bootstrap` or the form on the login screen (only when the user collection is empty).

## 2. Frontend (local)

```bash
cd client
cp .env.example .env.local
# VITE_API_URL=http://localhost:4000
npm install
npm run dev
```

Open `http://localhost:5173`.

## 3. Deploy

### API — Render

1. New **Web Service**, root directory `server` (or use the included `render.yaml` blueprint).
2. Build: `npm install && npm run build` (generates the Prisma client).
3. Start: `npm start` (starts Express immediately, then runs `prisma migrate deploy` in the background with a timeout). Render's Pre-Deploy Command is **not available on the free instance type**, so migrations cannot be a separate pre-deploy step on this plan. Prefer a Neon **unpooled** `DIRECT_URL` for migrations; the pooled `DATABASE_URL` is for app queries. `GET /health` is liveness (always 200 once listening); `GET /ready` reports the database.
4. Set env: `DATABASE_URL` (Neon pooled connection string, `?sslmode=require`), optional `DIRECT_URL` (Neon unpooled), `JWT_SECRET`, `API_PUBLIC_URL` (your `https://…onrender.com`), `CORS_ORIGIN` (your Vercel URL, comma-separated if multiple).

**Images:** Set Cloudinary (`CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_UPLOAD_PRESET`) and/or S3-compatible vars (`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_ENDPOINT` / `S3_PUBLIC_BASE_URL`). Local `server/uploads/` is the dev fallback when those are unset. Existing relative `uploads/…` paths still resolve.

### Frontend — Vercel

1. Import repo; set **Root Directory** to `client`.
2. Env: `VITE_API_URL=https://your-api.onrender.com` (no trailing slash).
3. Build: `npm run build`, output `dist`.
4. Add `vercel.json` rewrites (included) for SPA routing.

## API summary

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/auth/bootstrap` | No (only if DB has zero users) |
| POST | `/api/auth/login` | No |
| GET | `/api/auth/me` | JWT |
| POST | `/api/upload` | JWT (multipart `image`) |
| GET/POST | `/api/orders` | JWT |
| GET/PUT/DELETE | `/api/orders/:orderId` | JWT (DELETE admin only) |
| GET | `/api/orders/:orderId/barcode-label` | JWT (PDF) |
| GET | `/api/orders/:orderId/barcode-labels/batch` | JWT (PDF) |
| GET/POST/PATCH | `/api/customers` | JWT |
| POST | `/api/customers/:id/measurements` | JWT |
| GET/POST/PATCH | `/api/staff` | JWT |
| POST | `/api/staff/:id/deactivate` | JWT |
| POST/DELETE | `/api/order-items/:id/images` | JWT |
| GET | `/api/clothing-types` | JWT |
| POST | `/api/production/scan` | JWT (check-in/out) |
| GET | `/api/production/lookup` | JWT |
| GET | `/api/production/suggest-assignment` | JWT |
| POST | `/api/production/assignments` | JWT |
| GET | `/api/order-items/:id/timeline` | JWT |
| GET | `/api/order-items/:id/scan-details` | JWT |
| GET | `/api/staff/:id/workload` | JWT |
| GET | `/api/analytics/stage-distribution` | JWT |
| GET | `/api/dashboard/summary` | JWT |
| GET | `/api/dashboard/notifications` | JWT |
| GET | `/api/analytics/*` | JWT |

## Security

- Passwords hashed with bcrypt.
- JWT required for all business routes.
- CORS restricted via `CORS_ORIGIN`.
- Helmet / rate limiting recommended before public launch (add as needed).
