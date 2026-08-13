# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single product: a **Clothing Order Management System** living under
`clothing-order-system/`. It has two independently-installed npm apps:

- `clothing-order-system/server` — Express + Mongoose (MongoDB) REST API, ESM, port `4000`.
- `clothing-order-system/client` — React 18 + Vite + Tailwind PWA, dev server on port `5173`.

Standard commands live in each app's `package.json` and in `clothing-order-system/README.md`;
prefer those. Notes below are the non-obvious things.

### Services and how to run them

Three processes are needed for full end-to-end use:

1. **MongoDB** (required). Not managed by the app or the update script. It is installed at the
   system level (MongoDB 8.0). Start it as a background process before the server, e.g.:
   `mongod --dbpath /var/lib/mongodb --logpath /var/log/mongodb/mongod.log --bind_ip 127.0.0.1 --port 27017`
   (run once via tmux/background). The server refuses to boot if `MONGODB_URI` is unset.
2. **Server** — from `clothing-order-system/server`: `npm run dev` (uses `node --watch`).
3. **Client** — from `clothing-order-system/client`: `npm run dev` (Vite).

### Environment files (not committed; gitignored)

- `clothing-order-system/server/.env` — copy from `.env.example`. For local dev set
  `MONGODB_URI=mongodb://127.0.0.1:27017/clothing_orders`, a `JWT_SECRET`,
  `API_PUBLIC_URL=http://localhost:4000`, and `CORS_ORIGIN=http://localhost:5173`.
- `clothing-order-system/client/.env.local` — `VITE_API_URL=http://localhost:4000`.
  The client talks to the API directly via `VITE_API_URL`; the `/api` dev proxy in
  `vite.config.ts` (points at port 3000) is effectively unused — don't rely on it.

### First-run data + first user (non-obvious)

- Run the one-time seed once against a fresh DB, from `clothing-order-system/server`:
  `npm run migrate:phase1` (seeds clothing-type configs; safe/idempotent to re-run).
- There is no signup. Create the first admin via the login screen's "First-time setup" form,
  or `POST /api/auth/bootstrap` with `{email, password (min 8), name}`. Bootstrap only works
  while the `users` collection is empty; after that use `POST /api/auth/login`.

### Testing / building / linting

- Server tests: from `clothing-order-system/server` run `npm test` (Jest + Supertest). Tests use
  `mongodb-memory-server`, so they need **no** external MongoDB or `.env`.
- Client build: from `clothing-order-system/client` run `npm run build` (Vite; this is the real
  build gate — the build script does not run `tsc`).
- There is **no** lint tooling (no ESLint, no `lint` script) and no repo-wide typecheck script.
  Note: `npx tsc --noEmit` in `client` currently fails only on a pre-existing
  `"ignoreDeprecations": "6.0"` value in `client/tsconfig.json` that the installed TypeScript
  rejects; this does not affect `npm run build`.

### Gotchas

- Order creation requires each item to include the enum fields `neckType` (`V-shape|square|oval`),
  `handType` (`wide|normal`), and `size` (`adult|kids|baby`); if `measurements` is provided it must
  include `gender`. The React "New order" form fills these by default. Note the server currently
  crashes the process on an unhandled Mongoose validation rejection during order create, so a bad
  API payload will take the `node --watch` process down until it restarts — send valid payloads.
- Uploaded images are stored on local disk under `server/uploads/` (auto-created).
