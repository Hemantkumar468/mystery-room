# WhatsApp Notification Settings — Implementation Spec

Implementation prompt for a WhatsApp Settings section inside the PMS. Hand this to an implementer as-is.

**Status:** not implemented. Everything below is the specification.

---

## 1. Context

A standalone Node/Express service already exists at `WhatsApp Check/` in this repo. It sends WhatsApp messages through SmartWhap (`https://app.smartwhap.com/api/v2`) using a Bearer token (`wm_...`). **Do not rewrite it — reuse it.**

The following facts were verified against the live account (02 Sep 2026). Treat them as given:

1. **Free-form text is only delivered inside a 24-hour window** — the recipient must have replied to the business number in the last 24 hours. Outside it the API returns `201` with `status: "sent"` and the message still **fails**. Never use free-form text for ERP notifications.
2. **Only UTILITY-category approved templates are reliable.** MARKETING templates are dropped by Meta (error 131049, *"healthy ecosystem engagement"*). AUTHENTICATION is for OTP only.
3. **Templates cannot be created through the SmartWhap API** — their documented `POST /whatsapp-template` is not deployed (returns 405; a nonsense path returns the same, so it is a catch-all). Templates are created in the SmartWhap dashboard. This page therefore **syncs, manages and maps** templates — it does not create them.
4. **`"sent"` in a send response is not proof of delivery.** Real status comes from `GET /messages` or `GET /messages/{chatMessageId}`: `delivered` / `read` / `failed` with a reason.
5. The current token has `messages:read` but **not** `account:read`.

### Endpoints the service already exposes (default port 5055)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/whatsapp/verify` | Credential check (sends nothing) |
| GET/POST | `/api/whatsapp/templates` | Approved templates from the provider |
| POST | `/api/whatsapp/send/template` | `{ phone, templateName, languageCode, bodyParams[] }` |
| POST | `/api/whatsapp/send/text` | Only works inside the 24h window |
| POST | `/api/whatsapp/send/bulk` | Max 50 numbers |
| GET | `/api/whatsapp/messages?limit=&chatId=&status=` | History with delivery status |
| GET | `/api/whatsapp/status/:chatMessageId` | Status of one message |

---

## 2. Goal

Build a **WhatsApp Settings** section inside the PMS that exposes the whole notification system: templates, event mapping, delivery logs and test sending.

---

## 3. Placement

- Route: `/settings/whatsapp`
- Add a new `WHATSAPP_SETTINGS` key to `NAV_KEYS` and an entry in `ADMIN_NAV` (`client/src/components/layout/Sidebar.jsx`). It then appears in the mobile "More" sheet automatically, because `BottomNav` pulls `ADMIN_NAV` through `filterNav`. **Do not edit `BottomNav.jsx`.**
- Register the route in `client/src/App.jsx` wrapped in `<Gate k={NAV_KEYS.WHATSAPP_SETTINGS}>`.
- Visibility rules go in `client/src/lib/navPolicy.js`: visible to `LEADERSHIP` + `MANAGER`.

---

## 4. Permissions

Use the existing role constants in `server/src/core/constants/index.js`. Do not introduce new ones.

| Action | Who |
|---|---|
| View page and logs | `CAN_MANAGE` (MD, EA, Manager) |
| Sync templates, edit event mapping, send a test message | `CAN_MANAGE` |
| **Delete a template from the registry, delete an event mapping, edit credentials/settings** | **`CAN_ADMINISTER` (MD only)** |

Enforce on the **server**; hiding the button in the UI is not sufficient. The UI must also not render delete controls for anyone other than MD.

---

## 5. Backend

New module: `server/src/modules/pms/whatsapp/`, following the existing module pattern (`model / service / controller / routes / validation`).

### Models

**`WhatsappTemplate`** — local registry of templates synced from the provider

```
name, category, language, status (APPROVED | PENDING | REJECTED | REMOVED),
variableCount, bodyPreview, description, isActive, lastSyncedAt
```

**`WhatsappEventMap`** — ERP event → template mapping

```
eventKey        (TASK_ASSIGNED | TASK_REMINDER | TASK_OVERDUE | TASK_COMPLETED)
templateName, language
paramMapping    ordered array of ERP field paths, e.g.
                ["assignee.name", "task.phase", "task.title", "task.property", "task.dueDate", "task.url"]
recipientRule   assignee | manager | md | custom role
isEnabled, leadTimeDays
```

**`WhatsappLog`** — one row per message sent

```
eventKey, templateName, recipientUserId, phone, params[],
messageId (wamid), chatMessageId, status, statusMessage,
sentAt, deliveredAt, error, retryCount
```

**`WhatsappSetting`** — single document

```
isEnabled (global kill switch), serviceBaseUrl,
quietHoursStart, quietHoursEnd,
maxMessagesPerUserPerDay, escalateAfterDays
```

### Routes

All under `/api/pms/whatsapp`, behind the existing auth middleware.

| Method | Path | Permission |
|---|---|---|
| GET | `/settings` | CAN_MANAGE |
| PATCH | `/settings` | **MD** |
| POST | `/templates/sync` | CAN_MANAGE |
| GET | `/templates` | CAN_MANAGE |
| PATCH | `/templates/:id` | CAN_MANAGE (description / isActive only) |
| DELETE | `/templates/:id` | **MD** |
| GET / POST / PATCH | `/event-map` | CAN_MANAGE |
| DELETE | `/event-map/:id` | **MD** |
| POST | `/test-send` | CAN_MANAGE |
| GET | `/logs?status=&event=&from=&to=&page=` | CAN_MANAGE |
| POST | `/logs/:id/refresh-status` | CAN_MANAGE |

### Sync behaviour

Call `GET {serviceBaseUrl}/api/whatsapp/templates` and upsert into `WhatsappTemplate`, keyed on `name + language`. A template that disappears from the provider must be marked `status: 'REMOVED'`, **not deleted** — logs reference it.

### Test-send behaviour

Forward to `POST {serviceBaseUrl}/api/whatsapp/send/template`, then persist the returned `chatMessageId` in `WhatsappLog`. **Never return the access token or credentials to the client** — all provider calls stay server-side.

---

## 6. Frontend

Page: `client/src/features/settings/WhatsappSettingsPage.jsx`, using the existing `primitives.jsx` components and page CSS conventions. Four tabs.

### Tab 1 — Templates

- Table: Name · Category · Language · Variables · Status badge · Active toggle · Description
- "Sync from SmartWhap" button; show the last-synced timestamp after syncing
- Warning badge on MARKETING rows: *"Marketing templates get throttled by Meta — do not use for notifications"*
- Delete icon for MD only, behind a confirm dialog
- Info banner: *"New templates are created in the SmartWhap dashboard, not here — SmartWhap's API does not support creation."*

### Tab 2 — Event Mapping

- One row per ERP event: event name · selected template · recipient rule · lead time · enable toggle
- Template dropdown lists only **APPROVED** templates in **UTILITY / AUTHENTICATION** categories
- On selecting a template, render a field per `{{n}}` with a dropdown of ERP field paths (`assignee.name`, `task.title`, `task.phase`, `task.property`, `task.dueDate`, `task.url`)
- Live preview of the rendered message using the chosen mapping
- **Validation:** the number of mapped fields must exactly equal the template's variable count, otherwise block save

### Tab 3 — Delivery Logs

- Table: time · event · template · recipient · phone · status badge (delivered = green, sent = amber, failed = red) · reason
- Filters: status, event, date range; paginated
- Failed rows show the provider's exact `statusMessage`, e.g. *"more than 24 hours have passed since the customer last replied to this number"*
- Per-row "Refresh status" action
- Summary tiles at the top: sent / delivered / failed today

### Tab 4 — Settings

- Global enable/disable toggle (MD only)
- Service base URL (MD only)
- Quiet hours, max messages per user per day, escalation days
- Credential **status** from `/verify` — never display the token, only a masked form (`wm_ZHB****0BMV`) and a connection badge
- Test send panel: phone + template + variable values → send → show resulting `delivered` / `failed`

---

## 7. Do not

- Use free-form text for notifications — templates only
- Send the access token to the client bundle or in any API response
- Treat `"sent"` as success — always verify `delivered`
- Create new role or permission constants — use `CAN_MANAGE` / `CAN_ADMINISTER`
- Edit the hardcoded list in `BottomNav.jsx` — adding to `ADMIN_NAV` is enough
- Build any template-creation UI — the provider API does not support it

---

## 8. Acceptance criteria

1. MD, EA and Manager see "WhatsApp" in the sidebar and the mobile More sheet; Employee does not see it at all.
2. Sync pulls every approved template from SmartWhap into the registry with the correct category and variable count.
3. A Manager can map `TASK_ASSIGNED` to `pms_task_assigned`, bind all 6 variables to ERP fields, and see a correct preview.
4. A test send creates a log row, and refreshing it moves the status from `sent` to `delivered` or `failed`.
5. Delete controls are not rendered for Manager/EA, and calling the delete API directly as those roles returns **403**.
6. Turning off the global toggle stops every notification, including test sends.
7. Saving a mapping whose field count does not match the template's variable count fails with a clear error.

---

## Appendix — PMS templates to create in the SmartWhap dashboard

All **UTILITY**, language **en**, footer `Mystery Rooms PMS`. The task link is variable `{{6}}` rather than a URL button, so the ERP domain can change without re-approval.

### `pms_task_assigned`

```
Hi {{1}}, a new task has been assigned to you.

Phase: {{2}}
Task: {{3}}
Property: {{4}}
Due date: {{5}}

Open the task here: {{6}}

Please update the status in ERP once completed.
```

Samples: `Vikram` · `Phase 2 - Site Evaluation` · `Vendor Identification` · `Wave One, Sector 18 Noida` · `05 Sep 2026` · `https://erp.mysteryrooms.in/task/1042`

### `pms_task_reminder`

```
Hi {{1}}, this is a reminder for your pending task.

Task: {{2}}
Property: {{3}}
Due date: {{4}}
Time left: {{5}}

Open the task here: {{6}}

Please complete it before the due date.
```

Samples: `Vikram` · `Vendor Identification` · `Wave One, Sector 18 Noida` · `05 Sep 2026` · `2 days` · `https://erp.mysteryrooms.in/task/1042`

`{{5}}` carries the lead time (`3 days`, `2 days`, `1 day`, `due today`), so one template covers every reminder.

### `pms_task_overdue`

```
Hi {{1}}, your assigned task is overdue.

Task: {{2}}
Property: {{3}}
Due date was: {{4}}
Overdue by: {{5}}

Open the task here: {{6}}

Please update the status in ERP immediately.
```

Samples: `Vikram` · `Vendor Identification` · `Wave One, Sector 18 Noida` · `05 Sep 2026` · `3 days` · `https://erp.mysteryrooms.in/task/1042`

### `pms_task_completed`

Goes to the manager / MD, not the doer.

```
Hi {{1}}, a task has been marked as completed.

Task: {{2}}
Property: {{3}}
Completed by: {{4}}
Completed on: {{5}}

Review the task here: {{6}}

Please verify and approve it in ERP.
```

Samples: `Rahul` · `Vendor Identification` · `Wave One, Sector 18 Noida` · `Vikram` · `04 Sep 2026` · `https://erp.mysteryrooms.in/task/1042`

### Template rules that cause most rejections

- A placeholder cannot be the first or last thing in the body — text must surround it
- Placeholders must run in order (`{{1}}`, `{{2}}`, `{{3}}`) with no gaps
- Two placeholders cannot sit next to each other
- Every placeholder needs a sample value, and the counts must match exactly
- Promotional wording in a UTILITY template gets it re-classified as MARKETING, which is then throttled
- Names must be lowercase with underscores: `pms_task_assigned`, not `PMS Task Assigned`

Approval typically takes 5 minutes to 2 hours; Meta's stated limit is 24 hours.

---

## 9. Implementation plan

### Architecture decision to make first

`WhatsApp Check/` currently runs as a separate process on port 5055. For production, fold the provider logic into the server as `server/src/core/services/whatsapp.service.js` and keep `WhatsApp Check/` as the Postman sandbox. One deploy, no service-to-service auth, no second URL in `render.yaml`, and no scenario where notifications die because a second process is down.

### What already exists and must be reused

| Existing | Location | Role here |
|---|---|---|
| `notificationService.notify()` | `pms/notifications/notification.service.js` | WhatsApp becomes its second channel |
| Agenda job queue | `core/jobs/agenda.js` | Send queue, retries and scheduled reminders |
| CRM job pattern | `crm/tasks/reminder.job.js`, `crm/tickets/sla.job.js` | Copy for the reminder/overdue jobs |
| `User.phone` | `auth/auth.model.js:27` | Recipient number (needs normalising) |

**Core principle: do not scatter WhatsApp calls across the codebase.** Add the channel inside `notify()`. Every caller that already notifies — task assigned, approval needed, stage completed — gets WhatsApp with no change to `task.service.js`, `record.controller.js` or any other existing file. HRMS, Leave and Payroll later plug into the same place.

### Phases

**Phase 0 — Prerequisites** *(start today; these depend on other people)*

| # | Task | Blocking |
|---|---|---|
| 0.1 | Create the four UTILITY templates in the SmartWhap dashboard (Appendix) | Yes |
| 0.2 | Ask SmartWhap for the `account:read` scope and whether webhooks are supported | No |
| 0.3 | Verify every employee phone number and store it with a country code | Yes |
| 0.4 | Decide the public ERP URL used for task deep links (`{{6}}`) | Yes |
| 0.5 | Tell doers updates will arrive on WhatsApp; have them save the business number | No |

**Phase 1 — Server foundation** *(~2 days)*
Port the provider into `core/services/whatsapp.service.js`; add env vars; create the `pms/whatsapp/` module with the four models, routes, validation and controller; mount at `/api/pms/whatsapp`.
*Done when:* `POST /templates/sync` pulls SmartWhap's templates into the registry.

**Phase 2 — Channel integration** *(~2 days)*
Extend `notify()`: after writing the Notification docs, check global toggle → event map enabled → recipient has a phone → not quiet hours → under the daily cap → not a duplicate, then queue an Agenda `whatsapp:send` job. The job maps `paramMapping` to `bodyParams`, sends, and writes a `WhatsappLog` row with the `chatMessageId`.
**A WhatsApp failure must never affect the in-app notification** — same best-effort contract as `activityService.log`.
*Done when:* assigning a task rings the bell *and* sends WhatsApp, with no edit to `task.service.js`.

**Phase 3 — Reminders and overdue** *(~1.5 days)*
Two Agenda jobs on the CRM job pattern: `whatsapp:task-reminder` (daily 9:00) and `whatsapp:task-overdue` (daily 10:00), both building the `{{5}}` text (`2 days`, `due today`, `overdue by 3 days`) and escalating to the manager past `escalateAfterDays`. Deduplicate on `taskId + eventKey + date` so a re-run never double-sends.
*Done when:* a task due tomorrow produces exactly one reminder next morning.

**Phase 4 — Delivery status** *(~1 day)*
Agenda job `whatsapp:refresh-status` every 10 minutes over logs still in `sent` and under 24 hours old. Replace with a webhook if 0.2 confirms support.
*Done when:* logs show `delivered` / `failed` with the provider's reason.

**Phase 5 — Settings UI** *(~3 days)*
Nav key, `ADMIN_NAV` entry, route behind `<Gate>`, `whatsappApi.js` RTK Query slice, then the page. Build the tabs in this order: Templates (read-only, easiest) → Logs → Event Mapping (hardest: the variable-binding form) → Settings.
*Done when:* the seven acceptance criteria in section 8 pass.

**Phase 6 — Rollout**
Pilot with 3-5 people for 3-4 days, read the logs, fix bad phone numbers, then enable for all doers. Watch the logs daily for the first week — a spike in failures or blocks damages the number's quality rating.

### Timeline

| Phase | Effort | Parallel |
|---|---|---|
| 0 Prerequisites | 1 day + approval wait | With everything |
| 1 Server foundation | 2 days | — |
| 2 Channel integration | 2 days | After 1 |
| 3 Reminder/overdue jobs | 1.5 days | After 2 |
| 4 Status tracking | 1 day | With 3 |
| 5 Settings UI | 3 days | With 2-4 |
| 6 Rollout | 1 week | — |

**~8-9 working days**, or **~6** with backend and frontend running in parallel.

**Smallest useful milestone:** Phase 0.1 + Phase 1 + the `TASK_ASSIGNED` half of Phase 2 — about 3 days, and a doer gets a WhatsApp message the moment a task is assigned. Everything else builds on it.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Bad or missing phone numbers | **High** | Phase 0.3 is not optional — otherwise a large share of messages fail silently |
| Too many messages → users block the number | **High** | Daily cap, quiet hours and digest must ship in Phase 2, not later |
| Template rejected by Meta | Medium | Follow the Appendix rules; reword and resubmit under the same name |
| Per-message cost | Medium | Confirm the rate with SmartWhap and estimate monthly volume before rollout |
| Token missing a scope | Low | Sync fails loudly; request the scope from SmartWhap |
| SmartWhap outage | Low | Agenda retries; in-app notifications are unaffected |
