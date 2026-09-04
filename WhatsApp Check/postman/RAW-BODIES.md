# Postman test data — WhatsApp Check (SmartWhap)

Server must be running: `cd "WhatsApp Check" && npm start` → `http://localhost:5055`

For every request below:

- **Method:** POST (except where GET is stated)
- **Headers:** `Content-Type: application/json`
- **Body:** Postman → Body → **raw** → **JSON**
- Credentials come from `.env` — do **not** put `phoneNumberId` / `accessToken` in the body
- Replace `7495008424` with the number you want to test

---

## 1. Health — is the service up (no message, no provider call)

```
GET http://localhost:5055/api/whatsapp/health
```

No body.

---

## 2. Verify credentials — checks the token, sends NO message

```
POST http://localhost:5055/api/whatsapp/verify
```

```json
{}
```

Expected: `"success": true`, `"provider": "smartwhap"`. `scopeLimited: true` is normal — the token has no `account:read` scope, so it confirms via the templates endpoint instead.

---

## 3. Text message — the main credential test

```
POST http://localhost:5055/api/whatsapp/send/text
```

```json
{
  "phone": "7495008424",
  "message": "Hello from WhatsApp Check - test message"
}
```

Number formats that all work: `7495008424`, `07495008424`, `+91 74950-08424`, `917495008424`.

---

## 4. Generic route — type chosen in the body

```
POST http://localhost:5055/api/whatsapp/send
```

```json
{
  "phone": "7495008424",
  "type": "text",
  "message": "Sent through the generic route"
}
```

Valid `type` values on SmartWhap: `text`, `template`, `image`, `video`, `audio`, `document`, `media`, `interactive`, `button`, `list`, `cta`.

---

## 5. Template — works outside the 24-hour window

```
POST http://localhost:5055/api/whatsapp/send/template
```

**No variables** (safest first test):

```json
{
  "phone": "7495008424",
  "templateName": "crcampaign",
  "languageCode": "en_US"
}
```

**With variables** — `bodyParams` fills `{{1}}`, `{{2}}`, `{{3}}` in order:

```json
{
  "phone": "7495008424",
  "templateName": "feedback",
  "languageCode": "en_US",
  "bodyParams": ["Hemant", "Mystery Rooms", "Saturday 7 PM"]
}
```

Approved templates on this account and how many variables each needs:

| Variables | Templates |
|---|---|
| 0 | `crcampaign`, `challengeroomscampaigncr`, `new` |
| 1 | `otp_verification` (en_US), `new_grid_otp` (en) |
| 3 | `feedback`, `feedback_survey_1`, `cust_new`, `cust_new_2` (en), `ers_cust`, `ers_cust_new`, `new_ers_cust` (en), `automation` |
| 4 | `ers_emp`, `ers_emp_1` |

Wrong variable count or wrong `languageCode` = 422 from SmartWhap; the exact field is in `error.errors`.

---

## 6. Image

```
POST http://localhost:5055/api/whatsapp/send/image
```

```json
{
  "phone": "7495008424",
  "link": "https://www.w3.org/Graphics/PNG/nurbcup2si.png",
  "caption": "Image test"
}
```

## 7. Document

```
POST http://localhost:5055/api/whatsapp/send/document
```

```json
{
  "phone": "7495008424",
  "link": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  "filename": "Sample-Invoice.pdf",
  "caption": "Document test"
}
```

## 8. Video

```
POST http://localhost:5055/api/whatsapp/send/video
```

```json
{
  "phone": "7495008424",
  "link": "https://sample-videos.com/video321/mp4/480/big_buck_bunny_480p_1mb.mp4",
  "caption": "Video test"
}
```

## 9. Audio (no caption supported)

```
POST http://localhost:5055/api/whatsapp/send/audio
```

```json
{
  "phone": "7495008424",
  "link": "https://www.kozco.com/tech/piano2.wav"
}
```

Media limits (SmartWhap): image 5 MB (jpg, jpeg, png, webp) · document 100 MB (pdf, doc, docx, xls, xlsx) · video 16 MB · audio 16 MB. The URL must be publicly reachable — a link behind a login will fail.

---

## 10. Reply buttons (max 3)

```
POST http://localhost:5055/api/whatsapp/send/buttons
```

```json
{
  "phone": "7495008424",
  "header": "Booking confirmation",
  "message": "Do you want to confirm this booking?",
  "footer": "Mystery Rooms",
  "buttons": ["Yes", "No", "Call me"]
}
```

Custom button IDs (returned in your webhook when the user taps):

```json
{
  "phone": "7495008424",
  "message": "Do you want to confirm this booking?",
  "buttons": [
    { "id": "confirm_1042", "title": "Yes" },
    { "id": "cancel_1042", "title": "No" }
  ]
}
```

Button titles are cut to 20 characters.

---

## 11. List picker

```
POST http://localhost:5055/api/whatsapp/send/list
```

```json
{
  "phone": "7495008424",
  "header": "Available slots",
  "message": "Pick a slot for your game",
  "footer": "Mystery Rooms",
  "buttonText": "View slots",
  "sections": [
    {
      "title": "Saturday",
      "rows": [
        { "id": "sat_11", "title": "11:00 AM", "description": "Prison Break" },
        { "id": "sat_13", "title": "01:00 PM", "description": "Mystery Mansion" }
      ]
    },
    {
      "title": "Sunday",
      "rows": [
        { "id": "sun_11", "title": "11:00 AM", "description": "Bank Heist" }
      ]
    }
  ]
}
```

Max 10 sections. `buttonText` max 20 chars, `header`/`footer` max 60.

---

## 12. CTA link button (SmartWhap only)

```
POST http://localhost:5055/api/whatsapp/send/cta
```

```json
{
  "phone": "7495008424",
  "header": "Booking confirmed",
  "message": "Your booking is confirmed for Saturday 7 PM.",
  "footer": "Mystery Rooms",
  "buttonText": "View booking",
  "buttonUrl": "https://mysteryrooms.in/"
}
```

---

## 13. Bulk — same message to many numbers (max 50)

```
POST http://localhost:5055/api/whatsapp/send/bulk
```

```json
{
  "phones": ["7495008424", "9267999794"],
  "message": "Bulk test from WhatsApp Check"
}
```

Each number gets its own row in `data.results` with `success: true/false`, so one bad number does not stop the rest. Any of the fields above work here too — e.g. add `"type": "template"` with `templateName`.

---

## 13b. Was it actually delivered? (status check)

```
GET http://localhost:5055/api/whatsapp/status/607911
```

No body. Use the **`chatMessageId`** from the send response (a plain number like `607911`) — not the `wamid`.

```json
{
  "success": true,
  "message": "Message is \"delivered\"",
  "data": { "status": "delivered", "statusMessage": null, "isRead": false, "messageId": "wamid...." }
}
```

| `status` | Meaning |
|---|---|
| `sent` | WhatsApp accepted it, not yet delivered to the handset |
| `delivered` | It reached the phone |
| `read` | The recipient opened it |
| `failed` | Rejected — `statusMessage` says why (window closed, not opted in, invalid number) |

A send response of `"status": "sent"` is **not** proof of delivery. This endpoint is.

*(Needs the `messages:read` scope on the token — a 403 here means SmartWhap has to add it.)*

---

## 13c. Create a template (submit to Meta for approval)

```
POST http://localhost:5055/api/whatsapp/templates/create
```

```json
{
  "name": "task_assigned",
  "category": "UTILITY",
  "language": "en",
  "body": "Hi {{1}}, task \"{{2}}\" has been assigned to you. Due date: {{3}}. Please update the status in ERP.",
  "bodySampleValues": ["Vikram", "Phase 1 - Site Evaluation", "05 Sep 2026"],
  "footer": "Mystery Rooms ERP"
}
```

Rules the service checks before sending (so Meta does not reject you):

| Field | Rule |
|---|---|
| `name` | lowercase letters, numbers, underscores only — `task_assigned`, not `Task Assigned` |
| `category` | `UTILITY` for ERP notifications, `AUTHENTICATION` for OTP, `MARKETING` never |
| `body` | the sentence; `{{1}}`, `{{2}}` mark the parts your ERP fills in |
| `bodySampleValues` | one example per placeholder, exact same count — Meta needs them to review |
| `footer` | optional, max 60 chars |

Meta's own rules for approval:

- A placeholder cannot be the **first or last** thing in the body — text must surround it
- Placeholders must be numbered in order: `{{1}}`, `{{2}}`, `{{3}}` — no skipping
- Two placeholders cannot sit next to each other (`{{1}} {{2}}` ❌)
- UTILITY must sound operational. Any offer/discount/promo wording gets it re-classified as MARKETING, which then gets throttled

> ⚠️ **Not available on this SmartWhap account (checked 02 Sep 2026).** Their Swagger documents `POST /whatsapp-template`, but the live API answers `405 — POST not supported, only GET/HEAD` (a nonsense path returns the same, so it is a catch-all: the route simply is not deployed). Until SmartWhap enables it, **create templates in the SmartWhap dashboard**. This endpoint stays in the code and will work as soon as they turn it on.

Response is `status: "PENDING"`. Approval takes minutes to a few hours — poll with `GET /api/whatsapp/templates` until it shows `APPROVED`, then send it with `/send/template`.

---

## 14. List approved templates

```
POST http://localhost:5055/api/whatsapp/templates
```

```json
{}
```

Also works as `GET http://localhost:5055/api/whatsapp/templates`.

---

## 15. Raw passthrough — hit any SmartWhap endpoint directly

```
POST http://localhost:5055/api/whatsapp/send/raw
```

```json
{
  "payload": {
    "endpoint": "messages/text",
    "phone": "917495008424",
    "message": "Raw passthrough test"
  }
}
```

`endpoint` is the SmartWhap path after `/api/v2/` (`messages/text`, `messages/template`, `messages/cta`, …). Everything else is sent verbatim — no validation, no phone normalisation, so pass the number with country code.

---

## 16. Testing a DIFFERENT client's credentials (without touching .env)

Put the real token in the body — it overrides `.env` for that one request:

```json
{
  "accessToken": "wm_paste_the_real_token_here",
  "phone": "7495008424",
  "message": "Testing a different client token"
}
```

Or as headers (Postman → Headers tab):

```
x-wa-access-token: wm_paste_the_real_token_here
x-wa-provider: smartwhap
```

For a **Meta** account instead, send `"accessToken": "EAA..."` plus `"phoneNumberId": "15-digit-id"` — the provider switches automatically on the token prefix.

---

## Expected responses

**Success (HTTP 201):**

```json
{
  "success": true,
  "message": "WhatsApp text message accepted by smartwhap",
  "data": {
    "messageId": "wamid.HBgMOTE3NDk1MDA4NDI0FQIAERgS...",
    "messageStatus": "sent",
    "to": "917495008424",
    "waId": "917495008424",
    "type": "text",
    "provider": "smartwhap"
  }
}
```

`messageId` starting with `wamid.` means WhatsApp accepted it — that is the proof the credentials work.

**Failure:**

| HTTP | Meaning | What to do |
|---|---|---|
| 400 | Your input was wrong (missing `message`, bad phone, unsupported type) | Read `message` — it names the field |
| 401 | Token invalid, revoked, or from another tenant | Get a fresh token from SmartWhap |
| 403 `INSUFFICIENT_SCOPE` | Token is real but lacks a scope (`messages:send`, `account:read`) | Ask SmartWhap to add the scope |
| 422 | SmartWhap rejected a field (usually template name/language/variable count) | Check `error.errors` |
| 429 | Rate limit or plan quota reached | Wait, or check the plan |

Errors that are **not** sends (400) never cost a message. Only `2xx` responses actually deliver.

---

## Accepted (`"status": "sent"`) but nothing arrived on WhatsApp

This is normal and almost always the **24-hour customer service window**, not a credential problem.

WhatsApp only lets a business send **free-form** messages (`/send/text`, `/send/image`, `/send/buttons`, `/send/list`, `/send/cta`) to someone who has messaged that business number **within the last 24 hours**. Outside the window the API still returns `sent` — the message is just never delivered.

**Two ways to get a message through to a fresh number:**

1. **Send an approved template instead** — templates are exempt from the window:

   ```json
   { "phone": "9399643189", "templateName": "crcampaign", "languageCode": "en_US" }
   ```
   to `POST http://localhost:5055/api/whatsapp/send/template`

2. **Open the window first** — from the test phone, send any WhatsApp message to the business number **+91 9267999794**. For the next 24 hours every free-form type works to that number.

Other things to rule out, in order:

| Check | How |
|---|---|
| Was it really delivered? | `GET /api/whatsapp/status/{chatMessageId}` — `failed` + `statusMessage` names the cause |
| Right number? | The response echoes `to` — confirm the digits and that `91` was prepended correctly |
| Is that number on WhatsApp? | It must have an active WhatsApp account |
| Blocked / opted out? | If the user blocked the business number or opted out of marketing, delivery is dropped silently |
| Marketing limits | Marketing templates can be throttled or capped per user by WhatsApp |
