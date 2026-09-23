# Payluy backend

KHQR payment API: Express 5 + TypeScript + Prisma (PostgreSQL). See `../AGENTS.md` and `../docs/`.

## Setup

```bash
npm install
cp .env.example .env        # fill DATABASE_URL, SESSION_SECRET, GOOGLE_CLIENT_ID/SECRET
npx prisma migrate dev      # apply migrations
npm run dev                 # http://localhost:3001
```

`SESSION_SECRET` is required: the server refuses to start without one (`openssl rand -base64 48`).
Every payment goes to the real ABA PayWay endpoints, so a store needs a working payment link.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | compile in watch mode + restart the server |
| `npm run build` / `npm start` | compile to `dist/`, then run it |
| `npm run lint` · `npx tsc --noEmit` | lint and type check |
| `npx prisma db seed` | plans + a dev account + one API key |

## Layout

```
src/
  server.ts       listen, signals, start/stop the jobs
  app.ts          the express app: middleware + routes (no listen, so tests import it)
  container.ts    every service built once, in dependency order
  middleware/     auth (Bearer key or session cookie) · cors · error · validate (zod → 422)
  lib/            env (everything read from the environment) · errors · ids · money · log · zod · prisma (Db)
  modules/<f>/    <f>.controller.ts (HTTP) · <f>.service.ts (logic) · <f>.schema.ts (zod) · <f>.view.ts (JSON)
  jobs/           webhook-sender · detection-sweeper (Postgres polling loops, no Redis)
```

Controllers never touch Prisma, services never touch `req`/`res`, and only `container.ts` calls a `create*` factory.
