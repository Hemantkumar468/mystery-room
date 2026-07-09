# Design System — "Vault"

The visual language for the Mystery Rooms ERP. The name **Vault** captures the brand feeling —
mystery, intrigue, and the spark of _cracking the code_ — while staying calm and legible enough
for a data-dense enterprise tool used 8 hours a day.

> The palette is deliberately **distinct from the public mysteryrooms.in site** (which runs
> dark/red). This is an internal operations product; it earns its own identity.

## Concept

| Role      | Meaning                                    | Hue           |
| --------- | ------------------------------------------ | ------------- |
| Primary   | Mystery, premium, the brand anchor         | Indigo-violet |
| Accent    | The "clue" — discovery, action, highlights | Amber-gold    |
| Secondary | Signal, data, live status                  | Teal-cyan     |
| Ink       | Structure, surfaces, text                  | Cool slate    |

## Core tokens

Full definitions live in [`client/src/styles/tokens.css`](../client/src/styles/tokens.css).
Never hard-code a hex in a component — always reference a token.

```
Primary  (Enigma violet)   50 #F1EEFF · 500 #6E45FF · 700 #4922B4 · 900 #241157
Accent   (Clue amber)      400 #FFC24B · 500 #F5A623 · 600 #E08600
Secondary(Signal teal)     400 #2DD4BF · 500 #14B8A6 · 600 #0E8F9E
Ink      (Cool slate)      50 #F6F7FB · 500 #6B7280 · 900 #12101F · 950 #0B0A14
```

### Semantic

```
success  #10B981   warning  #F59E0B   danger  #F43F5E   info  #38BDF8
```

### Project health (used everywhere in the PMS)

```
on-track  → success   at-risk → warning   delayed → danger   planning → info
```

## Theming

Two themes ship from one token file, toggled by `data-theme` on `<html>`:

- **Light** (default): near-white ink-tinted surfaces, violet primary, amber accents. Sidebar is
  a deep ink-violet for a premium "command console" feel against the light workspace.
- **Dark**: deep `#0B0A14` canvas, elevated `#12101F` surfaces, brighter primary/accent for
  contrast.

All semantic colors are exposed as `--color-*` variables so components are theme-agnostic.

## Type & rhythm

- Font: system UI stack (`Inter` if available) — fast, neutral, dense.
- Scale: 12 / 13 / 14 / 16 / 20 / 24 / 30 / 38 px.
- Spacing: 4px base grid (`--space-1` = 4px … `--space-8` = 48px).
- Radius: `--radius-sm` 6px, `--radius` 10px, `--radius-lg` 16px, `--radius-pill` 999px.
- Elevation: three soft, violet-tinted shadow tokens (`--shadow-1..3`).

## Charts (MIS)

Recharts, colored strictly from the categorical ramp below (derived from the brand hues so every
chart reads as one system). Accessible in light + dark, no reliance on hue alone (labels + shape
back every series).

```
series: violet #6E45FF · teal #14B8A6 · amber #F5A623 · rose #F43F5E · sky #38BDF8 · lime #84CC16
```

## Component principles

1. **Calm surfaces, loud data.** Chrome is quiet ink; color is reserved for status, action, and
   data ink.
2. **One accent per view.** Amber marks the single most important action/insight on a screen.
3. **Status is a system.** Health, task status, and priority each map to a fixed badge style —
   learn once, read everywhere.
4. **Density with air.** Enterprise density, but generous line-height and 4px rhythm keep it
   scannable.
