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

## Franchise Network Map

Every outlet, candidate site and opportunity on one map of India. At **Network
Map** in the sidebar (`/network-map`).

**Two levels, and the difference is the design:**

| | India | City |
|---|---|---|
| Shows | one pin per city, with its count (`Delhi NCR (3)`) | individual outlets, leads and sites |
| Basemap | **India's own outline — no tiles, no other country** | satellite imagery or Streets 3D |
| Camera | flat, top-down | pitched |
| 3D buildings / terrain | off — nothing to see at country zoom | on |
| Answers | *where are we, and what is late* | *which unit is that, and what's happening to it* |

### The national view is a 3D map of India, not a world map cropped to it

Every general-purpose basemap draws the whole planet, so fencing the camera
still renders Pakistan, China and the Gulf around the edges — a world map you
aren't allowed to pan, which is a different thing.

So the country view is built from India's own geometry, bundled in
`features/network/indiaBoundary.js` (59 KB, simplified from DataMeet's 10.7 MB
`india-composite`, which follows the official Indian claim), and stacked like
this:

```
background            ← flat colour, the "space" the country sits in
hillshade  (relief)   ← real elevation, exaggerated ×7
mask       (not-India)← a rectangle with India punched out of it, in bg colour
India fill (42% tint) ← translucent, so the relief shows through
India outline
+ sky / atmospheric fog
```

**The mask is the trick.** A raster layer can't be clipped to a polygon, so the
hillshade necessarily renders the Hindu Kush and the Tibetan plateau along with
the Himalayas. Painting a world-sized rectangle with India cut out of it over
the top leaves exactly one lit landmass on screen.

**It's real elevation, not a generated look** — the same AWS terrarium DEM the
city view uses, at ×7 exaggeration. India is ~3,000 km wide and ~8.6 km tall
(1:350); true to scale the Himalayas are a rounding error, so the country view
multiplies them until mountains read as mountains. City level drops to ×1.2,
where the viewer is close enough for honest relief.

**Fully rotatable.** Opens tilted at 52° and off-north, with drag-rotate,
touch-rotate, touch-pitch and keyboard rotation all on, and a compass that
shows the tilt and resets with a click. Note that the camera fence is *looser*
at country level (`INDIA_ROTATE_BOUNDS`) than in a city: `maxBounds` constrains
the viewport, and a tilted camera sees to the horizon, so the tight box makes
MapLibre shove the camera back every few degrees and rotation feels broken. It
costs nothing to loosen, because there's no world basemap behind this view to
reveal.

If the DEM host is unreachable, the relief simply never engages and you get the
flat bundled outline — degraded, never blank.

Real imagery returns the moment you open a city.

Clicking a city pin drills in; the breadcrumb (**Franchise map / India /
Pune**) or the back arrow returns to the country.

A city's pin takes its **worst** status, not its most common one — four open
outlets and one delayed build shows red, because the delayed build is why
anyone opened the screen.

**The camera is fenced to India.** `maxBounds` + `minZoom` in
`features/network/cityCoords.js` mean there is no way to pan to the Atlantic or
zoom out to a world map. The box is padded wider than the coastline on purpose:
`maxBounds` constrains the viewport, not the centre, so a box hugging the
landmass makes MapLibre over-zoom on a wide monitor and crop Kashmir and
Kanyakumari off the edges.

> ### ⚠️ MapLibre must stay out of Vite's dep pre-bundling
>
> `vite.config.js` sets `optimizeDeps: { exclude: ['maplibre-gl'] }`. **Do not
> remove it.** MapLibre parses tiles and GeoJSON in a Web Worker that it loads
> by URL at runtime; Vite's optimizer rewrites the package into `.vite/deps/`
> and the worker URL stops resolving:
>
> ```
> net::ERR_FAILED .../.vite/deps/maplibre-gl-worker.mjs
> ```
>
> The failure is silent and very misleading. The map still mounts, WebGL still
> initialises, the canvas is the right size, HTML markers still render — but
> every source that needs the worker (every GeoJSON, every tile) produces
> nothing, so you see only the background layer. It looks exactly like a
> styling bug. It is not. If the map ever goes blank, check the network tab for
> that request before touching any colours.

> ### ⚠️ Open it in a real browser tab
>
> MapLibre GL runs its tile parsing in a **Web Worker**. That is fine in an
> ordinary browser tab, and blocked in some embedded or sandboxed preview panes
> — an IDE's built-in preview, a restrictive iframe, or a headless screenshot
> tool. In those the map fails to start and the page shows an error panel
> rather than a map. Nothing is wrong with the build; open `localhost:5173` in
> the browser itself.
>
> It also needs **WebGL**. A VM with no GPU passthrough, or a browser with
> hardware acceleration disabled, will hit the same panel.

**No API key is needed.** The India view needs no network at all. The city view
uses Esri World Imagery (satellite), OpenFreeMap "liberty" or CARTO Voyager
(vector streets, both keyless), OSM building footprints, and AWS Terrain Tiles
for elevation. Their attribution is rendered by the map and is the licence
condition they are free under — don't strip it.

> **Streets 3D has two tile hosts, tried in order.** OpenFreeMap was
> unreachable from the machine this was built on — DNS resolved, TCP never
> connected, while every other host including other Cloudflare-fronted sites
> answered fine. Whether that was an upstream outage or a local network block
> could not be determined from inside. If the first host does not answer, the
> map falls back to CARTO Voyager and says so on screen rather than showing a
> white rectangle. Both carry `render_height` on OSM buildings, so 3D
> extrusions work either way. See `STREETS_STYLE_CANDIDATES` in
> `features/network/mapStyles.js`.

Upgrading later to Google Photorealistic 3D Tiles or Cesium is a single seam:
`photorealAvailable()` in `features/network/mapStyles.js`, keyed off
`VITE_GOOGLE_3D_TILES_KEY`. Setting that variable alone changes nothing — those
are OGC 3D Tiles, which MapLibre cannot render without CesiumJS or deck.gl
alongside.

```bash
npm run test -w client       # map slice + data normaliser (Vitest)
```

## Roadmap (ERP modules)

1. **PMS** — Project Management System _(in progress)_
2. CRM — leads, franchise enquiries, broker pipeline
3. HRMS — hiring, onboarding, attendance per outlet
4. Bookings — slot & game inventory, revenue
5. Finance — budgets, POs, settlements
6. Assets & Inventory — props, kits, maintenance
