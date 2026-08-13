# Sabit

**Sabit** is a private Salah consistency app. Track your five daily prayers, build streaks, manage Qada, earn Laqabs, and optionally stay accountable with friends — without public leaderboards or guilt-based messaging.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Backend-3FCF8E?logo=supabase&logoColor=white)

## Features

- **Today** — Live prayer times (Adhan), mark completed/missed, auto-miss at window end
- **Prayer Details** — Full dynamic screen per prayer with Qada and streak integration
- **Qada** — Track and make up missed prayers
- **Progress** — Streaks and completion history
- **Laqabs** — Milestone titles unlocked through consistency
- **Friends & Challenges** — Private accountability with friends (no global leaderboard)
- **Notifications** — Prayer reminders, streak/Laqab/Qada encouragement (browser-based)
- **Profile** — Account, privacy, and notification settings

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite |
| Routing | React Router |
| Backend | Supabase (Auth, Postgres, RLS) |
| Prayer times | [Adhan](https://github.com/batoulapps/adhan-js) |
| Styling | Custom CSS (mobile-first) |

## Project structure

```
sabit/
├── public/              # Static assets served as-is
├── src/
│   ├── assets/          # Logo and bundled images
│   ├── components/      # Shared UI (Dashboard, BottomNav, etc.)
│   ├── hooks/           # useTodayPrayers, useStreak, notifications
│   ├── lib/             # Supabase, prayer logic, friends, notifications
│   ├── pages/           # Route screens
│   └── utils/           # Prayer time calculations
├── supabase/            # SQL migrations (run in Supabase SQL Editor)
│   ├── setup.sql
│   ├── friends-challenges.sql
│   └── notifications.sql
├── .env.example         # Environment template (copy to .env)
└── package.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20+ recommended)
- A [Supabase](https://supabase.com/) project (free tier works)
- Git (for GitHub)

## Local setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/sabit.git
cd sabit
npm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Find these in **Supabase Dashboard → Project Settings → API**.

> **Never commit `.env` to GitHub.** It is listed in `.gitignore`.

### 3. Supabase database

You need a base schema with tables: `profiles`, `prayer_records`, `streaks`, `laqabs`, `user_laqabs`, `qada_records`.

Then run these SQL files **in order** in the **Supabase SQL Editor** (only needed once per Supabase project, or when setting up a new environment):

1. `supabase/setup.sql` — Laqabs seed, RLS, user settings, signup trigger
2. `supabase/friends-challenges.sql` — Friends, private challenges, RPCs
3. `supabase/notifications.sql` — Extended notification settings

If you already ran these on Supabase, you do **not** need to run them again — your live database is already set up.

### Should you push the SQL files to GitHub?

**Yes, it's normal and safe.** SQL files are **not secret**. They only contain:

- Table structures
- Security policies (RLS)
- Public seed data (Laqab names)
- Database functions

They do **not** contain passwords, API keys, or user data.

**What is secret (never push):**

- `.env` — your Supabase URL and keys
- Supabase **service_role** key (never use in frontend anyway)

**Why keep SQL in the repo even after running them?**

- Backup of how your database is built
- Useful if you create a second Supabase project later
- Standard practice for team projects

**If you prefer not to push SQL:** add `supabase/` to `.gitignore`. Your app will still work — the database already lives on Supabase. Most developers still commit SQL for documentation.

### 4. Supabase Auth

In **Authentication → Providers**, enable **Google** (or your preferred provider) and add your site URL to redirect URLs:

- `http://localhost:5173` (development)
- Your production URL when deployed

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 6. Production build

```bash
npm run build
npm run preview
```

Deploy the `dist/` folder to [Vercel](https://vercel.com), [Netlify](https://netlify.com), or any static host.

### Vercel deployment

1. **Import** your GitHub repo on [vercel.com/new](https://vercel.com/new)
2. **Framework preset:** Vite (auto-detected)
3. **Environment variables** (Project → Settings → Environment Variables):

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | Your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key |

   Apply to **Production**, **Preview**, and **Development**. Then **Redeploy**.

4. **Supabase Auth URLs** (Supabase Dashboard → Authentication → URL Configuration):

   | Setting | Value |
   |---------|-------|
   | Site URL | `https://your-app.vercel.app` |
   | Redirect URLs | `https://your-app.vercel.app/**` |

   Add `http://localhost:5173/**` too if you still develop locally.

5. **`vercel.json`** is included — it routes all paths to `index.html` so React Router works on refresh (e.g. `/qada`, `/profile`).

If the app shows **"Configuration required"**, env vars are missing on Vercel — add them and redeploy.

## Push to GitHub (step-by-step)

### First time

1. **Create a GitHub account** at [github.com](https://github.com) if you don't have one.

2. **Create a new repository** on GitHub:
   - Click **New repository**
   - Name: `sabit`
   - Visibility: Public or Private
   - Do **not** initialize with README (you already have one)
   - Click **Create repository**

3. **Initialize Git in your project folder** (PowerShell):

```powershell
cd C:\Users\Administrator\Documents\sabit\sabit

git init
git add .
git status
```

Verify `.env` is **not** listed (it should be ignored). If it appears, do not commit it.

4. **First commit**:

```powershell
git commit -m "Initial commit: Sabit prayer tracking app"
```

5. **Connect to GitHub** (replace `YOUR_USERNAME`):

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sabit.git
git push -u origin main
```

GitHub may ask you to sign in. Use a [Personal Access Token](https://github.com/settings/tokens) as the password if prompted.

### Later updates

```powershell
git add .
git commit -m "Describe your changes"
git push
```

## Security checklist before pushing

- [ ] `.env` is **not** tracked (`git status` should not show it)
- [ ] `.env.example` has placeholder values only
- [ ] Supabase **anon** key is fine in frontend (RLS protects data)
- [ ] Never put the Supabase **service_role** key in frontend code
- [ ] RLS policies are enabled on all user tables

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run oxlint |

## Design principles

- **Private worship** — No public Salah leaderboards
- **Encouraging notifications** — Remind, never shame
- **Dynamic data** — Prayer times, streaks, and progress come from the database and Adhan calculations
- **RLS everywhere** — Users can only access their own prayer records

## License

Private project — add a license if you plan to open-source.

## Support

For database issues, re-run the SQL files in order. For RLS recursion on Friends, re-run `friends-challenges.sql` (it drops old policies safely).
