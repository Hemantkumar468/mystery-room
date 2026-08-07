# Deployment — Render (API) + Netlify (SPA)

Two services, two different domains. Everything below exists because of that
one fact: the browser treats `*.netlify.app` and `*.onrender.com` as different
sites, which changes how CORS and cookies behave.

---

## About `Route not found: POST /api/v1/auth`

That response is **correct**, not a bug. There is no `POST /api/v1/auth` route
and there never was — `/auth` is a router mount point, not an endpoint. The
real endpoints are:

| Method | Path                  | Purpose                     |
| ------ | --------------------- | --------------------------- |
| POST   | `/api/v1/auth/login`  | sign in                     |
| POST   | `/api/v1/auth/refresh`| rotate the access token     |
| POST   | `/api/v1/auth/logout` | clear the refresh cookie    |
| GET    | `/api/v1/auth/me`     | current user                |

The frontend never requests bare `/auth` (see `client/src/app/api/authApi.js`),
so seeing that 404 means the path was typed or configured by hand. In practice
there is one configuration mistake that produces it:

**`VITE_API_BASE_URL` already ends in `/auth`.** The client appends
`/auth/login` to whatever base it is given. Set the base to the API prefix and
nothing more:

```
✅ VITE_API_BASE_URL=https://mysteryrooms-api.onrender.com/api/v1
❌ https://mysteryrooms-api.onrender.com          → posts to /auth/login (no prefix, 404)
❌ https://mysteryrooms-api.onrender.com/api/v1/  → double slash
❌ https://mysteryrooms-api.onrender.com/api/v1/auth
```

To confirm a deploy is alive, hit `GET /health` (unversioned, exempt from the
rate limiter) — not `/api/v1/auth`.

---

## 1. Backend on Render

`render.yaml` at the repo root is a Blueprint — **Render → New → Blueprint**,
point it at this repo, and it creates the service with the right build and
start commands. Or configure a Web Service by hand with:

| Setting        | Value                    |
| -------------- | ------------------------ |
| Root directory | *(repo root — not `server/`)* |
| Build command  | `npm install`            |
| Start command  | `npm run start -w server`|
| Health check   | `/health`                |
| Node version   | 20                       |

The root directory matters: this is an npm-workspaces monorepo, and installing
from inside `server/` skips the workspace linking.

### Environment variables to set in the dashboard

Required:

| Variable             | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| `NODE_ENV`           | `production` — **also what makes the refresh cookie work**    |
| `MONGO_URI`          | the Atlas connection string                                   |
| `JWT_ACCESS_SECRET`  | long random string                                            |
| `JWT_REFRESH_SECRET` | a *different* long random string                              |
| `CLIENT_ORIGINS`     | `https://your-site.netlify.app` — scheme + host, no trailing slash |
| `PUBLIC_API_URL`     | `https://your-service.onrender.com/api/v1`                    |

`CLIENT_ORIGINS` is compared against the browser's `Origin` header — scheme +
host, no path. A trailing slash is tolerated (stripped on load), since pasting
from the address bar is the usual mistake. Comma-separate for several origins.

When an origin is refused, the server logs the reason with both sides shown:

```
CORS blocked origin "https://x.netlify.app" — it is not in CLIENT_ORIGINS
[https://y.netlify.app]. Values are matched exactly: scheme + host, ...
```

The browser can never tell you this — it only reports a missing
`Access-Control-Allow-Origin` header — so the Render log is the place to look.

### `CLIENT_ORIGINS=*` — accept any origin

Sets the API to reflect whatever origin calls it. Note this does **not** send
`Access-Control-Allow-Origin: *`: that header is illegal on a credentialed
request, and every request here carries the refresh cookie, so a literal
wildcard would allow nothing at all.

It is an escape hatch for getting a deploy working, not a resting state.
Combined with the `SameSite=None` refresh cookie it means any site a signed-in
user visits can call this API as them and read the response — including
trading their cookie for a live access token at `/auth/refresh`. The server
logs a warning on every boot while it is set. Replace it with the real origin
once the frontend URL is settled.

Optional (the app boots without them — AI endpoints answer 503, uploads fail
with a clear message): `GROQ_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`XAI_API_KEY`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`.

### Two Render specifics

**Atlas IP allowlist.** Render's free tier has no static outbound IP. Either
allow `0.0.0.0/0` in Atlas → Network Access, or upgrade for a static IP.
Without this the server boots and then dies on `MongooseServerSelectionError`.

**Cold starts.** A free instance sleeps after ~15 minutes idle and takes
~50 seconds to wake. The first request after idle — including the login —
will look like a hang. Before a demo, hit `/health` once to wake it.

---

## 2. Frontend on Netlify

`netlify.toml` at the repo root already sets the build. Confirm in the UI:

| Setting        | Value                          |
| -------------- | ------------------------------ |
| Base directory | *(empty — repo root)*          |
| Build command  | `npm install && npm run build` |
| Publish        | `client/dist`                  |

### One environment variable

```
VITE_API_BASE_URL = https://your-service.onrender.com/api/v1
```

Set it in **Site settings → Environment variables**, not in a file. Vite gives
an already-present environment variable priority over `client/.env.production`,
so the Netlify value wins — and previews can point elsewhere without a commit.

This is a **build-time** variable. Changing it requires a redeploy; it is baked
into the bundle, not read at runtime.

### SPA routing

`client/public/_redirects` and `netlify.toml` both carry `/* /index.html 200`.
Without it, reloading on `/projects/abc` returns Netlify's own 404 because the
file doesn't exist — React Router never gets to see the URL.

---

## 3. The cross-site cookie (read this one)

The session is two tokens: a short-lived access token held in memory, and a
7-day **httpOnly refresh cookie**. When the access token expires after 15
minutes, the client silently POSTs `/auth/refresh` and the browser is supposed
to attach that cookie.

Across two domains, that POST is a **cross-site** request, and a
`SameSite=Lax` cookie is simply not sent on it. The symptom is specific and
confusing: login works, the app loads, and then 15 minutes later — or on the
first page reload — the user is bounced to the login screen.

The fix is already in the code. `config.cookie` derives the attributes from
`NODE_ENV`:

| `NODE_ENV`    | SameSite | Secure |
| ------------- | -------- | ------ |
| `production`  | `none`   | `true` |
| anything else | `lax`    | `false`|

`SameSite=None` is only honoured on a `Secure` cookie, which requires HTTPS —
Render and Netlify both serve HTTPS by default, so this works out of the box.

**This is why `NODE_ENV=production` must be set on Render.** Without it the
server runs with `Lax` + non-Secure and the session silently breaks.

Override with `COOKIE_SAMESITE` / `COOKIE_SECURE` only if the API later moves
onto the SPA's own domain.

---

## 4. Alternative: one origin, no CORS

Instead of pointing the SPA at Render directly, proxy through Netlify. Leave
`VITE_API_BASE_URL` unset (the client falls back to a relative `/api/v1`) and
uncomment the proxy block in `netlify.toml`:

```toml
[[redirects]]
  from = "/api/*"
  to = "https://your-service.onrender.com/api/:splat"
  status = 200
  force = true
```

It must sit **above** the SPA fallback. The browser then sees the API as
first-party: CORS stops applying, and the refresh cookie is same-site with no
`SameSite=None` needed. The cost is an extra network hop on every request and
Netlify bandwidth on all API traffic.

Pick one. Setting `VITE_API_BASE_URL` *and* enabling the proxy means the proxy
is dead code.

---

## 5. Post-deploy checklist

```bash
# 1. API is awake
curl https://your-service.onrender.com/health
# → {"success":true,"status":"ok",...}

# 2. Login works and issues a cookie with the right attributes
curl -i -X POST https://your-service.onrender.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"md@gmail.com","password":"..."}'
# → Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=None
#   If it says SameSite=Lax, NODE_ENV is not set to production on Render.

# 3. CORS accepts the Netlify origin
curl -i -X OPTIONS https://your-service.onrender.com/api/v1/auth/login \
  -H 'Origin: https://your-site.netlify.app' \
  -H 'Access-Control-Request-Method: POST'
# → access-control-allow-origin: https://your-site.netlify.app
#   Missing? CLIENT_ORIGINS doesn't match — check for a trailing slash.
```

Then in the browser: sign in, **reload the page**, and confirm you stay signed
in. That reload is the test that catches the cookie problem, and it is the one
people skip.

### Symptom → cause

| What you see | Cause |
| --- | --- |
| `Route not found: POST /api/v1/auth` | `VITE_API_BASE_URL` includes `/auth`, or the path was typed by hand |
| `Route not found: POST /auth/login` | `VITE_API_BASE_URL` is missing the `/api/v1` suffix |
| CORS error in console | `CLIENT_ORIGINS` doesn't exactly match the site origin |
| Login works, reload logs you out | `NODE_ENV` not `production` on Render → cookie is `SameSite=Lax` |
| Deep links 404, `/` is fine | SPA fallback missing from the publish directory |
| First request hangs ~50s | Render free-tier cold start |
| `MongooseServerSelectionError` | Atlas Network Access doesn't allow Render's IP |
| `429 Too Many Requests` | Raise `RATE_LIMIT_MAX`; it is per-IP and an office shares one |
