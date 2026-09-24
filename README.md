# Mystery Rooms ERP

> A modular, scalable enterprise platform for **Mystery Rooms** — India's #1 live escape-room brand.
> **Module 1 (this repo): PMS — the Project Management System** that drives the end-to-end
> franchise-expansion lifecycle: from broker-sourced sites → inspection → negotiation → contract
> → interior fit-out → HR staffing → soft launch.

The ERP is built as a **modular monolith**: one deployable platform, many independently-owned
business modules. PMS ships first; CRM, HRMS, Bookings, Inventory, and Finance modules slot in
later without re-architecting.

---

## Why this architecture

Mystery Rooms opens franchises city-by-city. Every launch is a repeatable, multi-department
project with dozens of dependent steps and hard SLAs (a ready site goes live in ~45–60 days).
The PMS lets operations teams **design a reusable Template** of stages + tasks, spin up a
**Project** per city from that template, assign **Tasks** to doers, capture **Master Data** at
each stage, and watch it all on a **Dashboard**, **Calendar**, and **MIS** analytics layer.

## Tech stack

| Layer     | Choice                                                                 |
| --------- | ---------------------------------------------------------------------- |
| Backend   | Node.js 20, Express 4, MongoDB + Mongoose                              |
| Auth      | JWT (access + refresh), bcrypt, role-based access control (RBAC)       |
| Logging   | Winston + daily-rotate-file (production), Morgan HTTP stream           |
| Security  | Helmet, CORS, rate-limiting, mongo-sanitize, hpp, compression          |
| Validation| Zod schemas at the route boundary                                      |
| Frontend  | React 18, Vite, React Router, TanStack Query, Recharts, React Hook Form |
| Design    | Hand-crafted design-token system ("Vault" theme) — light + dark        |

## Repository layout

```
mystery-room/
├── server/          # Node/Express/MongoDB API (modular monolith)
│   └── src/
│       ├── config/      # env, logger, database
│       ├── core/        # cross-cutting middleware, utils, constants
│       ├── modules/     # feature modules (auth, pms/*)
│       └── routes/      # versioned route aggregation
├── client/          # React + Vite SPA
│   └── src/
│       ├── app/         # router, providers
│       ├── components/  # design-system UI, layout, charts
│       ├── features/    # dashboard, templates, projects, tasks, calendar, mis
│       ├── lib/         # api client, query client, helpers
│       └── styles/      # design tokens + globals
└── docs/            # ARCHITECTURE.md, DESIGN_SYSTEM.md
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for module conventions and
[docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) for the visual language.

## Getting started

```bash
# 1. Install everything (npm workspaces)
npm install

# 2. Configure the server
cp server/.env.example server/.env
#   → set MONGO_URI and JWT secrets

# 3. Seed the Mystery Rooms demo (franchise-launch template + sample projects)
npm run seed

# 4. Run both apps (API on :5000, web on :5173)
npm run dev
```

Default seeded login: `admin@mysteryrooms.in` / `Admin@123`

## Operations modules — Delegation & Checklist

Beside the PMS, two operations modules run the day-to-day: **Delegation** (assign work, follow
it through acceptance, verification and closure, with sub-tasks, loops, groups, repeat rules,
reminders and escalations) and **Checklist** (recurring routines — opening checks, room resets,
safety audits — scheduled automatically with compliance reporting). They share an organisation
layer (branches / teams / groups) with branch-, team- and group-wise views, and feed a
Performance scoreboard. See [docs/DELEGATION_CHECKLIST.md](docs/DELEGATION_CHECKLIST.md).

```bash
npm run seed:ops -w server   # demo data for the ops modules (touches only its own collections)
```

## Roadmap (ERP modules)

1. **PMS** — Project Management System _(in progress)_
2. **Delegation & Checklist** — operations task management _(in progress)_
3. CRM — leads, franchise enquiries, broker pipeline
4. HRMS — hiring, onboarding, attendance per outlet
5. Bookings — slot & game inventory, revenue
6. Finance — budgets, POs, settlements
7. Assets & Inventory — props, kits, maintenance
