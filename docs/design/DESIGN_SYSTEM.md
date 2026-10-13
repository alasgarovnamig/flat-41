# EvTap Design System — "Soft Monochrome"

Source of truth for the look of **web, admin, iOS and Android**. Tokens: `packages/design-tokens/tokens.json`
(generated: `dist/tokens.css`, `dist/tokens.ts`, `dist/EvTapTokens.swift`, `dist/EvTapTokens.kt` — run
`pnpm --filter @evtap/design-tokens build` after editing).

Reference: the "Aurex Living" real-estate dashboard (`docs/design/reference/1-5.jpg`). Decisions were cross-checked
with **ui-ux-pro-max** (`--design-system "real estate property dashboard minimal soft light premium"`):
style → *Glassmorphism / Soft UI* (frosted layered cards, subtle depth), palette → *Luxury/Premium* (near-black ink +
warm accent on off-white), its pre-delivery checklist (contrast 4.5:1, 44px targets, visible focus, reduced motion,
no emoji icons). Its suggested teal palette and Cinzel serif were **rejected** because the reference is monochrome
with a geometric grotesk — the reference wins on visual direction, the skill wins on UX rules.

## 1. Principles
1. **Monochrome first.** Ink (#0B0B0C) on soft greys. Colour is information, not decoration: peach accent for the
   secondary metric, green/amber/red only for status, gold only for VIP.
2. **Soft, layered surfaces.** Canvas `#E9E9EB` → frame `#F2F2F3` (big rounded app frame, 36px) → cards `#F6F6F7`
   (28px radius, inner white highlight + very soft shadow) → raised white (`#FFFFFF`) for property card bodies,
   inputs, popovers. Glass (`backdrop-blur 20px`, 58% white) for sticky headers, floating bars, map overlays.
3. **Pills everywhere.** Navigation, filters, tags, buttons are fully rounded. Active = black pill + white text;
   inactive = `pill #E2E2E5` + ink text. Never square buttons.
4. **Big quiet numbers.** KPIs use Outfit 400, 30–44px, tight tracking; the currency symbol is `muted` grey and
   smaller weight (`₼ 276 880` where ₼ is grey). Labels above in 13px muted.
5. **Photography carries colour.** Property photos are large, top-rounded (22px), and fade into the white card body.
   The hero shows a large cut-out house image bleeding off the right edge.
6. **Thin line icons** (Lucide; SF Symbols on iOS; Material Symbols *Outlined* on Android), 1.6px stroke, inside 44px
   circular icon buttons (`surfaceSunken` bg). Arrow-up-right ↗ is the universal "open" affordance.

## 2. Components (all platforms implement these with the same names)
| Component | Spec |
|---|---|
| **AppFrame** | Canvas bg, centered frame (max 1440px web) with `radius.frame` and `frame` colour; on mobile the frame is the screen |
| **TopNav (web/admin)** | Left: logo (black rounded square with white mark) + wordmark "EvTap". Center: pill tabs (active black). Right: 44px circular icon buttons (search, bell with dot, settings) + 44px avatar |
| **TabBar (mobile)** | Floating glass capsule 64px high, 16px from bottom, 5 items max; active item = black pill with white icon+label |
| **Card** | `surface`, `radius.xl` 28, padding 20–24, shadow `card`. Title 19px/500 top-left; optional ↗ icon button top-right (white circle 36px) |
| **StatCard** | Card + label + big number (`type.number`) + "This month" caption + **BarcodeSpark** right-aligned |
| **BarcodeSpark** | 24–32 thin vertical bars (2px, gap 3px); historic bars `subtle`, the last ~8 bars `ink` with full height — reads as a barcode |
| **SplitMeter** | Two metrics side by side (e.g. Sold / Rented): numbers on top, below a 16px pill track: left part `ink`, right part `accent`, remainder **hatched** (45° stripes `subtle` on transparent) |
| **PillBarChart** | Horizontal bars: white pill track with value label inside left (12px), filled part ends in a black pill holding the delta tag "+10%" in white; x-axis 0–60 in `muted` 11px; grid lines `hairline` vertical |
| **PropertyCard** | White card radius 22; image top (4:3) with bottom fade to white; top-right: heart in white circle 36px + black circle ↗; meta row: "• For Rent" (dot coloured by deal type) + orange ★ 4.8; title 15/500, address 12 muted, price right (`₼` muted + value ink); spec chips row (m², rooms, baths, floor) in 11px muted pills |
| **Badges** | VIP: `vipBg` + `vip` text + star · Premium: black pill white text "Premium" · Təcili: `dangerBg` red dot · Yoxlanılıb: `successBg` check · Business/Agentlik: `pill` ink · Status: Active=successBg/success, Pending=warningBg/warning, Rejected/Blocked=dangerBg/danger |
| **FilterPill** | 44px high pill (`surfaceRaised` on cards, `pill` on canvas) with leading line icon + label + chevron-down; selected = ink outline 1.5px |
| **SearchField** | Pill, leading magnifier, `surfaceRaised`, 44px; secondary 44px circular "sliders" filter button beside it |
| **DataTable** | Inside a Card. Header row 12px muted, no vertical lines, rows 64px with 48px rounded thumbnails, status pills, trailing action icon button; hover row = `surfaceSunken` |
| **MapCard** | Card with title "Map" + expand icon; map tiles desaturated (CSS `filter: grayscale(1) contrast(.95) brightness(1.05)`); price clusters = black circles with white count, price labels = white pills; selected area = radial peach gradient (`accent` → transparent) |
| **Button** | Primary: black pill white text 44–52px; Secondary: `pill`; Ghost: transparent; Destructive: `danger` text on `dangerBg`. Press: scale .98, 150ms |
| **Input** | `surfaceRaised`, radius 16, 48px, 1px `hairline`, focus ring 2px ink at 20% + border ink |
| **Sheet / Modal** | `surfaceRaised`, radius 28 top (mobile sheet) / all (desktop), scrim `scrim`, glass header |
| **Segmented** | Pill track `pill`, selected segment white with shadow `pill` (e.g. Daily / Weekly / Monthly) |
| **EmptyState** | Large thin-line illustration-like icon in a 72px circle, title h3, body muted, black pill CTA |

## 3. Layout recipes
* **Admin dashboard** = the reference screen: row 1 SplitMeter (Listings sold vs rented, revenue split) + hero house
  image; row 2 two stacked StatCards (Total revenue, Completed deals/bookings) + PillBarChart card (Average sale
  value / revenue by purpose, Daily dropdown) + "Property Object" card (3 PropertyCards of top/premium listings);
  row 3 DataTable with FilterPills (District, Type, Status, Cost) + MapCard.
* **Admin navigation**: TopNav pills for primary areas (Dashboard, Moderation, Listings, Users, Payments, Bookings) +
  "More" pill opening a glass popover grid with the rest; page title row under the nav.
* **Website**: TopNav (Satış · Kirayə · Günlük · Agentliklər · Yeni tikililər) + black "+ Elan yerləşdir" pill;
  hero = big Outfit headline + search card (glass) + cut-out house image right; sections are Cards on the canvas.
* **Mobile**: canvas background, 20px side margins, large title (h1) + circular icon buttons, horizontal scroll of
  PropertyCards, StatCards in a 2-column grid, floating glass TabBar.

## 4. Accessibility & UX rules (ui-ux-pro-max checklist)
- Text contrast ≥ 4.5:1 in both themes: `muted` #646469 is ≥ 4.8:1 on canvas/surfaces; status texts are darkened for their tinted backgrounds; text on the peach `accent` uses `onAccent`
- Touch targets ≥ 44×44; spacing ≥ 8px between targets
- Visible focus ring on every interactive element (web); `accessibilityLabel` / `contentDescription` on icon buttons
- `prefers-reduced-motion` / iOS Reduce Motion / Android animator scale respected (no scale/translate animations)
- Never rely on colour alone: statuses have text, VIP has a star icon
- Skeletons with the same radius as the final content; no layout shift when images load (fixed aspect ratio)
- Dark mode = same structure with the `dark` token set (ink becomes near-white, black pills become white pills)
