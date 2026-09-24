# Delegation & Checklist modules

Two operations modules that sit beside the PMS: **Delegation** (hand work to people and follow it
to closure) and **Checklist** (recurring routines — opening checks, room resets, safety audits —
scheduled automatically). Both share an **Organisation** layer (branches, teams, groups,
categories, holidays, notifications) and feed a **Performance** scoreboard.

They were ported from an earlier PostgreSQL/Fastify system to this MongoDB/Express codebase. The
business rules were kept and a handful of defects fixed along the way (see *Behaviour notes*).

## Data — new collections only

Nothing in the existing PMS collections (`users`, `templates`, `projects`, `tasks`, `activities`)
changes. The only addition to `users` is three **optional** fields — `branch`, `reportingManager`,
`opsFlags.{coordinator,director}` — declared without defaults, so existing user documents are
never rewritten until an admin sets them.

| Collection | Holds |
| --- | --- |
| `org_branches` | Head office / regional offices / outlets — the "headquarters-wise" partition |
| `org_teams` | Standing teams with members, team roles (member · manager · admin) and reporting lines |
| `org_groups` | Ad-hoc working groups that tasks can be filed under (a group filter — membership alone does not reveal a task) |
| `org_categories`, `org_tags` | Managed task categories and tags |
| `org_holidays` | Company holidays (`YYYY-MM-DD` keys) |
| `org_notifications` | In-app inbox (auto-expires after 90 days) |
| `org_activity_log` | Audit trail for the ops modules (separate from PMS `activities`) |
| `org_counters` | Atomic sequences for `DLG-000123`, `CHK-00012`, `CT-000456` codes |
| `dlg_delegations` | Delegated tasks |
| `dlg_remarks`, `dlg_revisions`, `dlg_reminders`, `dlg_followups` | Conversation, status/date history, scheduled reminders, coordinator call logs |
| `dlg_recurrences` | Repeat rules for recurring delegations |
| `dlg_templates` | Reusable task presets |
| `chk_masters` | Checklist routines (the rule) |
| `chk_tasks` | Dated occurrences of a routine |
| `chk_sites` | Managed list of outlet rooms / areas |

## Access model

**Delegation visibility is user-wise.** A task is visible only to the people officially on it:
its assigner, its doer and the people explicitly kept in the loop. The MD and the EA (the ERP's
leadership roles — referred to as *admin* below) see every task. Being in
the same group, managing the doer, or holding a flag does not reveal a task — the assigner has to
include the person. Sub-tasks stay visible up the chain because the parent's assigner and loop are
copied into each sub-task's loop.

| ERP role | Delegation | Checklist |
| --- | --- | --- |
| MD, EA (admin) | every task, any branch or all branches at once | everything |
| Manager | tasks they assign, own or are looped into | own + direct reports + teams they manage + own department; department report |
| Employee | tasks they assign, own or are looped into | own occurrences |
| Viewer | same as Employee, read-only | own, read-only |

Branches, teams, holidays and ops-flag settings are changed by MD / EA (team managers edit their own
teams); categories and tags by MD / EA / Manager.

**Settings → Access Control** lists the four modules — *Delegation*, *Checklist*, *Ops Performance*
and *Teams & Branches* — like every other module, so the MD can hide any of them per role or person.
The API enforces the same switch (`requireModule`).

**Admin-wise view.** Admins and managers get an *Assigned by* switch on the task lists
(*Everyone* · *Me* · *Any admin*) and a *Created by* switch on the checklist page. *Me* on an MD / EA
login shows only the delegations that login assigned / the checklist routines it created. Every
KPI card, list, drill-down, routine list and department report follows the switch (API:
`assignedBy=me|admins` on delegation lists, `createdBy=me|admins` on checklist endpoints;
*Any admin* means any MD or EA account).

Users flagged **coordinator** can log follow-up calls on the tasks they are included in. Users
flagged **director** receive the 7-day overdue escalation.

Every list is partitioned by **branch**: the branch switcher offers *My branch* (the person's home
branch, else the default branch), a specific branch, or *All branches* (MD, EA and managers).
Filters are available **team-wise**, **group-wise** and **branch-wise** across delegation,
checklist and performance.

## Companies (tenancy)

Every ops collection carries the ERP's company (`tenant`) field through the shared tenancy plugin,
so each company sees only its own branches, teams, tasks, routines, holidays and notifications.
Branch codes, category and tag names, holiday dates and the `DLG-` / `CHK-` / `CT-` codes are unique
**per company** (each company numbers from 1). Scheduled jobs run once per company inside that
company's context. `npm run migrate:tenancy -- --apply` stamps any rows created before tenancy
existed; `npm run seed:ops` seeds the default company.

## Delegation lifecycle

```
pending ─accept→ accepted ─start→ in_progress ─complete→ completed
                                               └submit→ awaiting_verification ─approve→ completed
                                                                                └send back→ pending
pending/accepted ─dependent on others→ dependent ─resume→ accepted
                 (naming a person hands the task to them instead)
pending/accepted/in_progress ─blocked by→ blocked ─resume→ accepted
completed ─reopen→ in_progress        (assigner or admin, with a reason — from the task drawer
                                      or the Reopen button on completed rows in the task lists)
```

* **Deadline changes** — the server decides: first date → *initial*; same business week → uses a
  revision slot (max two); different week → the task closes as **Shifted** and a fresh copy opens
  (sub-tasks and pending reminders move with it).
* **Completion** needs every checklist item ticked, and proof when *proof required* is on.
* **Remark channels** — *management follow-ups* (each one is a chase and counts in the
  responsiveness score) and *coordinator notes*; both are append-only and time-stamped.
* **Sub-tasks** — any depth; remarks roll up to the parent; deleting a parent trashes its tree and
  restoring brings it back.
* **Repeat rules** — daily, weekly (weekdays), monthly (dates incl. *last*), yearly, every N days,
  or custom (every N weeks on weekdays / every N months on dates).
* **Reminders** — per task, relative to the due date, in-app or in-app + email. With none chosen,
  a day-before nudge and a day-after chase are added. At most one reminder per task per day.

## Checklist

A routine materialises every dated occurrence up to its end date (default 31 Dec; *auto-renew*
extends it a year ahead as it nears). Weekly/fortnightly land on an anchor weekday (default
Saturday), monthly on an anchor day (default the 28th). Chosen weekly-off days and holidays are
skipped by rolling forward to the next working day without drifting the cadence. Editing a routine
only touches open, upcoming occurrences; history is immutable. An occurrence can be completed (with
proof when required), marked **non-functional** (excluded from compliance rather than counted as a
miss), or reassigned (optionally for every later occurrence too). Admins and managers can
**reopen** a completed or non-functional occurrence with a reason: it goes back to pending for the
doer (who is notified) and the reason is appended to its coordinator notes. Declaring a holiday moves open
occurrences off it (daily ones are dropped).

## Scheduled jobs (business timezone, `OPS_TIMEZONE`)

| When | Job |
| --- | --- |
| every minute | fire due delegation reminders |
| 01:00 | auto-renew checklist routines near their end date |
| 08:30 | checklist digest per doer |
| 09:00 | overdue digest to doers and assigners |
| 09:30 | escalation matrix — 3 days: reporting manager · 7 days: directors · 15 days: review-meeting badge |
| 10:00 | approval chase for assigners with submitted work |
| 23:50 | create tomorrow's recurring delegations |

All jobs are idempotent. Set `JOBS_ENABLED=false` on extra API instances.

## API (under `/api/v1`)

* `/org` — `branches`, `teams` (+ `/:id/members`), `groups`, `categories`, `tags`, `holidays`,
  `people`, `notifications`, `activity`
* `/delegation` — `tasks` (list, summary, deleted, collaborators, detail, create, edit, delete,
  restore) and task actions `status`, `complete`, `approve`, `send-back`, `reopen`, `due-date`,
  `dependent`, `blocked`, `reassign`, `comments`, `management-remark`, `coordinator-note`,
  `followups`, `reminders`; plus `templates` and `recurrences` (+ `preview`)
* `/checklist` — `summary`, `departments`, `report/departments`, `sites`, `routines`, `tasks` and
  task actions `complete`, `non-functional`, `reassign`, `reopen`, bulk `tasks/remarks`
* `/performance` — `kra` (KRA/KPI report) and `scoreboard` (XP, levels, badges, team & branch boards)
* `/files` — upload evidence / proof / references (served back from `/files/raw/…`)

## Naming — what changed from the source system

| Source system | Mystery Rooms ERP |
| --- | --- |
| Office locations "HO" / "Bhandup" | Managed **branches** (Head Office, outlets…) |
| "MD remark" | Management follow-up |
| "EA remark" | Coordinator note |
| "PC" designation (follow-up calls) | Operations coordinator flag |
| "Director" designation match | Director flag |
| Task IDs `Task/…`, `TSK/…`, `CHK/…` | `DLG-000001`, `CT-000001`, `CHK-00001` |

## Behaviour notes (fixes over the source)

* Codes come from atomic counters, so deleted rows or concurrent requests can't produce duplicates.
* Due-date changes only go through the revise endpoint, so the two-revision cap can't be bypassed.
* "Sunday is always off" became a per-routine weekly-off choice — outlets trade seven days a week.
* Day boundaries use the business timezone, not the host's clock.
* Recurring generation claims each day atomically, so a job re-run can't double-create.

## Running it

```bash
npm install
npm run seed:ops -w server              # demo branches, teams, tasks, routines (non-destructive)
npm run seed:ops -w server -- --link-users   # also set demo reporting lines / flags on the demo users
npm run seed:ops:reset -w server        # clear ONLY the ops collections, then seed
```

Optional environment variables are listed in `server/.env.example` (timezone, jobs, uploads, SMTP).
