# Type Racer

Private **1v1 typing races** for you and a friend. Create a room, share the link, both ready up, first to finish the passage wins.

## Stack

- **Next.js** (App Router) — UI
- **PartyKit** — realtime room state
- **Tailwind CSS** — dark competitive UI
- No database (ephemeral rooms + static passage bank)

## Local development

```bash
npm install
npm run dev
```

- App: [http://localhost:3000](http://localhost:3000)
- PartyKit: `ws://127.0.0.1:1999`

Copy `.env.example` → `.env.local` if needed:

```
NEXT_PUBLIC_PARTYKIT_HOST=127.0.0.1:1999
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Next + PartyKit together |
| `npm run dev:next` | Next only |
| `npm run dev:party` | PartyKit only |
| `npm run build` | Production Next build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run ci` | Lint + typecheck + build |
| `npm run deploy:party` | Deploy PartyKit server |

## CI/CD

GitHub Actions workflows live in `.github/workflows/`:

| Workflow | When | What |
|----------|------|------|
| **CI** (`ci.yml`) | Push / PR to `main` or `master` | `npm ci` → lint → typecheck → Next build |
| **Deploy** (`deploy.yml`) | Push to `main`/`master`, or manual | PartyKit + optional Vercel deploy |

### Secrets (repo → Settings → Secrets and variables → Actions)

| Secret | Required for | How to get it |
|--------|----------------|---------------|
| `PARTYKIT_TOKEN` | PartyKit CD | Run `npx partykit token` after `npx partykit login` |
| `VERCEL_TOKEN` | Vercel CD via Actions | [Vercel → Account → Tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Vercel CD | From `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | Vercel CD | From `.vercel/project.json` after `vercel link` |

Deploy jobs **skip** when their secrets are missing, so CI still works on a fresh fork.

**Simpler frontend option:** connect the repo in the Vercel dashboard (Git integration) and only use Actions for PartyKit. Either way, set production env on Vercel:

```
NEXT_PUBLIC_PARTYKIT_HOST=type-racer.YOUR_USERNAME.partykit.dev
```

## Deploy (free tiers)

1. Deploy PartyKit: `npm run deploy:party` (login when prompted), or push to `main` with `PARTYKIT_TOKEN` set
2. Set `NEXT_PUBLIC_PARTYKIT_HOST` on Vercel to your `*.partykit.dev` host
3. Deploy the Next app to Vercel (dashboard Git integration, or Actions with Vercel secrets)

## How a race works

1. Enter a name → **Create race**
2. Copy the room link to your friend
3. Both click **Ready** → 3s countdown → type
4. First to complete the passage wins (WPM + accuracy shown)
5. **Rematch** in the same room (new passage)

Guest nicknames only; refresh reconnects via `sessionStorage` for ~45s.
