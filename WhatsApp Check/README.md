# WhatsApp Check

A standalone Node.js + Express service used to **verify a client's WhatsApp API credentials** by actually sending a message to an Indian mobile number from Postman.

Two providers are supported and picked automatically from the token shape:

| Provider | Token | Host | Phone Number ID |
|---|---|---|---|
| `smartwhap` | `wm_…` | `https://app.smartwhap.com/api/v2` | not used (the token identifies the sender) |
| `meta` | `EAA…` | `https://graph.facebook.com` | required, 15 digits, goes in the URL |

**This project is currently configured for SmartWhap** — the credentials Mystery Rooms received (`+91 9267999794`, "Mystery Rooms", Number ID `807077809157824`) are SmartWhap tenant credentials, not Meta ones. Sending them to `graph.facebook.com` returns `OAuthException 190` no matter what.

It is independent of the main PMS app — nothing in `client/` or `server/` imports it, and it runs on its own port.

---

## 1. Setup

```bash
cd "WhatsApp Check"
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm start
```

Fill in `.env`:

```env
PORT=5055
WHATSAPP_PROVIDER=smartwhap                   # meta | smartwhap | blank to auto-detect
WHATSAPP_ACCESS_TOKEN=wm_...                  # SmartWhap API token (or EAA... for Meta)
WHATSAPP_PHONE_NUMBER_ID=807077809157824      # Meta only; informational on SmartWhap
WHATSAPP_BASE_URL=                            # blank = the provider's default host
WHATSAPP_BUSINESS_ACCOUNT_ID=                 # Meta only, for listing templates
GRAPH_API_VERSION=v21.0                       # Meta only
DEFAULT_COUNTRY_CODE=91
API_KEY=                                      # optional; if set, send header x-api-key
```

Base URL: `http://localhost:5055`

---

## 2. Where the credentials come from

Every endpoint resolves credentials in this order (first match wins):

| Priority | Source | Keys |
|---|---|---|
| 1 | JSON body | `accessToken`, `phoneNumberId`, `provider`, `baseUrl` |
| 2 | Headers | `x-wa-access-token`, `x-wa-phone-number-id`, `x-wa-provider`, `x-wa-base-url` |
| 3 | `.env` | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_PROVIDER`, `WHATSAPP_BASE_URL` |

**Once `.env` is filled in, leave `phoneNumberId` / `accessToken` OUT of the Postman body** — body values override `.env`, so a leftover sample value like `"EAAG..."` silently replaces your real token and the provider answers `401 Cannot parse access token`. Sample values are now rejected before any network call.

So when a client hands over a fresh credential pair, you can test it **without editing `.env`** — just include it in the Postman body:

```json
{
  "accessToken": "wm_<their real token>",
  "phone": "9876543210",
  "message": "Testing client credentials"
}
```

### Choosing the provider

Auto-detected from the token (`wm_` → SmartWhap, `EAA` → Meta). Override with `WHATSAPP_PROVIDER` in `.env`, `"provider"` in the body, or an `x-wa-provider` header. A third panel can be pointed at with `WHATSAPP_BASE_URL` / `"baseUrl"` if it mirrors one of these two API shapes; anything else needs a new file in `src/providers/`.

Underneath, each provider hits its own API:

```
SmartWhap   POST https://app.smartwhap.com/api/v2/messages/text
            Authorization: Bearer wm_...

Meta        POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
            Authorization: Bearer EAA...
```

---

## 3. Phone number format

Pass the number any of these ways — it is normalised to E.164 digits automatically:

| Input | Sent to WhatsApp as |
|---|---|
| `9876543210` | `919876543210` |
| `09876543210` | `919876543210` |
| `+91 98765-43210` | `919876543210` |
| `919876543210` | `919876543210` |

A non-Indian number just needs its own country code (`14155550123`). Pass `"countryCode": "971"` to change the default used for bare 10-digit numbers.

---

## 4. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Endpoint directory |
| GET | `/api/whatsapp/health` | Service up-check (no Meta call) |
| GET/POST | `/api/whatsapp/verify` | **Check credentials without sending anything** |
| GET/POST | `/api/whatsapp/templates` | List approved templates (needs `businessAccountId`) |
| POST | `/api/whatsapp/send` | Generic — pick the type via `"type"` |
| POST | `/api/whatsapp/send/text` | Plain text |
| POST | `/api/whatsapp/send/template` | Approved template |
| POST | `/api/whatsapp/send/image` | Image by URL |
| POST | `/api/whatsapp/send/video` | Video by URL |
| POST | `/api/whatsapp/send/audio` | Audio by URL |
| POST | `/api/whatsapp/send/document` | PDF / doc by URL |
| POST | `/api/whatsapp/send/sticker` | Sticker (.webp) *(Meta only)* |
| POST | `/api/whatsapp/send/location` | Map pin *(Meta only)* |
| POST | `/api/whatsapp/send/buttons` | Up to 3 reply buttons |
| POST | `/api/whatsapp/send/list` | List picker |
| POST | `/api/whatsapp/send/contacts` | Contact card *(Meta only)* |
| POST | `/api/whatsapp/send/reaction` | Emoji reaction to a message *(Meta only)* |
| POST | `/api/whatsapp/send/cta` | Message with a link button *(SmartWhap only)* |
| POST | `/api/whatsapp/send/bulk` | Same message to up to 50 numbers |
| POST | `/api/whatsapp/send/raw` | Any raw Cloud API payload |

---

## 5. Postman bodies

### Verify credentials (no message sent)

`POST /api/whatsapp/verify` — with credentials in `.env`, the body is simply:

```json
{}
```

Testing someone else's pair instead? Put the **real** values in the body (sample values are rejected):

```json
{ "phoneNumberId": "807077809157824", "accessToken": "<real token>" }
```

```json
{
  "success": true,
  "message": "Credentials are valid",
  "credentials": { "provider": "smartwhap", "baseUrl": "https://app.smartwhap.com/api/v2", "accessToken": "wm_ZHB****0BMV" },
  "account": { "tokenValid": true, "scopeLimited": true, "approvedTemplates": 15 }
}
```

On SmartWhap this reads `GET /account`. The current token has no `account:read` scope, so the check falls back to `GET /templates` — enough to prove the token is live, reported as `scopeLimited: true`. Ask SmartWhap to add `account:read` if you want plan/subscription details too.

### Text — the main check

`POST /api/whatsapp/send/text`

```json
{
  "phone": "9876543210",
  "message": "Hello from WhatsApp Check ✅"
}
```

```json
{
  "success": true,
  "message": "WhatsApp text message accepted by smartwhap",
  "data": {
    "messageId": "wamid.HBgMOTE3NDk1MDA4NDI0FQIAERgSRUVDMjE3RjRDQ0JENThFMDdGAA==",
    "messageStatus": "sent",
    "to": "917495008424",
    "waId": "917495008424",
    "type": "text",
    "provider": "smartwhap"
  }
}
```

> Free-form text only reaches a user inside the 24-hour customer-service window (i.e. after they message you). Outside it the send fails (Meta code **131047**) and you must use an approved template — see below.

### Generic route

`POST /api/whatsapp/send`

```json
{ "phone": "9876543210", "type": "text", "message": "Hi", "previewUrl": false }
```

### Template — works even with no prior conversation

`POST /api/whatsapp/send/template`

```json
{
  "phone": "9876543210",
  "templateName": "crcampaign",
  "languageCode": "en_US"
}
```

Template names must be **approved on the account** — `POST /api/whatsapp/templates` lists them (15 approved on this SmartWhap tenant — `crcampaign`, `challengeroomscampaigncr` and `new` take no variables; `ers_emp` takes 4; `feedback`, `cust_new`, `automation` take 3; `otp_verification` takes 1). On SmartWhap, `bodyParams` maps to `field_1`…`field_10`; on Meta it becomes template `components`.

With variables (`{{1}}`, `{{2}}` in the template body):

```json
{
  "phone": "9876543210",
  "templateName": "order_update",
  "languageCode": "en",
  "bodyParams": ["Hemant", "MR-1042"]
}
```

`components` may also be passed verbatim if the template needs a media header or buttons.

### Image / Document

```json
{ "phone": "9876543210", "link": "https://example.com/banner.jpg", "caption": "New room launch" }
```

```json
{ "phone": "9876543210", "link": "https://example.com/invoice.pdf", "filename": "Invoice-1042.pdf", "caption": "Your invoice" }
```

Media links must be **public HTTPS URLs**. Alternatively pass `"mediaId"` for media already uploaded to Meta.

### Location

```json
{ "phone": "9876543210", "latitude": 28.6139, "longitude": 77.209, "name": "Mystery Rooms", "address": "Connaught Place, New Delhi" }
```

### Buttons / List

```json
{ "phone": "9876543210", "message": "Confirm your booking?", "buttons": ["Yes", "No"] }
```

```json
{
  "phone": "9876543210",
  "message": "Pick a slot",
  "buttonText": "View slots",
  "sections": [
    { "title": "Saturday", "rows": [ { "id": "s1", "title": "11:00 AM" }, { "id": "s2", "title": "1:00 PM" } ] }
  ]
}
```

### Reaction (Meta only)

```json
{ "phone": "9876543210", "messageId": "wamid.HBgMOTE5...", "emoji": "👍" }
```

### CTA link button (SmartWhap only)

`POST /api/whatsapp/send/cta`

```json
{ "phone": "9876543210", "message": "Your booking is confirmed", "buttonText": "View booking", "buttonUrl": "https://mysteryrooms.in/booking/1042" }
```

### Bulk

`POST /api/whatsapp/send/bulk`

```json
{ "phones": ["9876543210", "9123456780"], "message": "Broadcast test" }
```

Each number gets its own row in `data.results`, so one bad number does not fail the batch.

### Raw passthrough

```json
{
  "payload": {
    "messaging_product": "whatsapp",
    "to": "919876543210",
    "type": "text",
    "text": { "body": "Raw payload test" }
  }
}
```

---

## 6. Error responses

Failures are returned in a readable shape with a hint instead of a raw provider dump.

**SmartWhap:**

```json
{
  "success": false,
  "message": "Your API token does not have the required permissions for this action. Required scope: account:read",
  "error": {
    "provider": "smartwhap",
    "status": 403,
    "code": "INSUFFICIENT_SCOPE",
    "requestId": "57d36e65-aaac-414d-ac7a-857eb341bd45",
    "hint": "The token is valid (SmartWhap recognised it) but lacks the scope this endpoint needs..."
  }
}
```

Handled: **401** (bad/revoked token), **403 INSUFFICIENT_SCOPE** (missing `messages:send` / `account:read`), **422** (field validation — see `errors`), **429** (rate limit or plan quota).

**Meta:**

```json
{
  "success": false,
  "message": "Error validating access token: Session has expired",
  "error": {
    "type": "OAuthException",
    "code": 190,
    "fbtrace_id": "A1b2C3",
    "hint": "Access token is invalid or expired. Generate a new one in Meta > WhatsApp > API Setup (temporary tokens last 24h)."
  }
}
```

Common Meta codes handled: **190** (bad/expired token), **100** (bad Phone Number ID or payload), **131030** (recipient not in the test-number allow-list), **131047** (24-hour window closed → use a template), **131026** (not a WhatsApp user).

---

## 7. Quick cURL

```bash
curl -X POST http://localhost:5055/api/whatsapp/send/text \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","message":"Hello from WhatsApp Check"}'
```

A ready-made Postman collection is in [postman/WhatsApp-Check.postman_collection.json](postman/WhatsApp-Check.postman_collection.json) — import it and set the `baseUrl`, `phoneNumberId`, `accessToken` and `phone` collection variables.
