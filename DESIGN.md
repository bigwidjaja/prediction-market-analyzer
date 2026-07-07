# DESIGN.md — Prediction Market Analyzer

Design system for every screen in this app. Inspired by **Linear** (dark, dense,
quiet UI with a single indigo accent). **Nothing outside this document may be
used in UI code** — no new colors, font sizes, spacing values, or radii.

---

## 1. Color palette

All colors are defined once in `tailwind.config.ts` under `theme.colors`
(replacing Tailwind's default palette so off-system colors are impossible to
reference).

```ts
colors: {
  transparent: "transparent",
  current: "currentColor",

  // Backgrounds
  bg:      "#08090A",   // app background
  surface: "#131416",   // cards, panels, table headers
  raised:  "#1C1D21",   // hover states, inputs, nested surfaces

  // Lines
  border:  "#26282D",   // all borders and dividers

  // Text
  text: {
    DEFAULT: "#F7F8F8", // primary text
    muted:   "#8A8F98", // secondary text, labels, captions
    faint:   "#5E6066", // disabled text, placeholders, tertiary meta
  },

  // Accent (Linear indigo)
  accent: {
    DEFAULT: "#5E6AD2",
    hover:   "#6E79D6",
    muted:   "#5E6AD226", // 15% alpha — tinted chips/fills
  },

  // Semantic
  success: { DEFAULT: "#4CB782", muted: "#4CB78226" },
  warning: { DEFAULT: "#DEB949", muted: "#DEB94926" },
  error:   { DEFAULT: "#EB5757", muted: "#EB575726" },
}
```

Usage rules:

- Page background is always `bg`; content sits on `surface` cards.
- `raised` is only for hover states, inputs, and elements nested inside a
  `surface` card.
- Every border/divider is `border` — never a gray utility.
- YES/long positions and upward movement use `success`; NO/short positions and
  downward movement use `error`; `warning` is reserved for stale data,
  closing-soon, and risk notices.
- The `*-muted` alpha variants are the only permitted tinted backgrounds
  (badges, chips, tinted icons). Never use an opacity utility to fake a tint.

## 2. Typography

One family, one mono family, **four sizes**. Defined in `tailwind.config.ts`
under `fontFamily` / `fontSize` (replacing the defaults).

```ts
fontFamily: {
  sans: ["Inter", "system-ui", "sans-serif"],
  mono: ["JetBrains Mono", "monospace"],  // numbers: prices, odds, volume
},
fontSize: {
  xs:   ["0.6875rem", { lineHeight: "1rem" }],    // 11px — overlines, badges, table headers
  sm:   ["0.8125rem", { lineHeight: "1.25rem" }], // 13px — body, tables, buttons (default size)
  base: ["0.9375rem", { lineHeight: "1.5rem" }],  // 15px — section/card titles
  lg:   ["1.375rem",  { lineHeight: "1.75rem" }], // 22px — page titles, hero stats
}
```

Usage rules:

- `text-sm` is the default; the app is dense, Linear-style.
- Weights: `font-normal` for body, `font-medium` for titles/buttons/emphasis,
  `font-semibold` only for `text-lg` page titles and hero stat values.
- All numeric data (prices, probabilities, volume, P&L) uses `font-mono` with
  `tabular-nums` (applied globally via the `.num` utility in `index.css`).
- Overlines/table headers: `text-xs font-medium uppercase tracking-wider
  text-text-muted`.

## 3. Spacing & border radius

4px grid. Only these spacing steps may appear in UI code:

| Token | px | Use |
|-------|-----|-----|
| `1`   | 4   | icon–label gaps, badge padding-y |
| `2`   | 8   | gaps inside controls, badge padding-x |
| `3`   | 12  | table cell padding, gaps between related items |
| `4`   | 16  | card padding, grid gutters |
| `6`   | 24  | page padding, gaps between sections |
| `8`   | 32  | top-of-page / hero separation |

Border radius (defined in config, replacing defaults):

```ts
borderRadius: {
  none: "0",
  sm:   "4px",   // badges, chips, small inline controls
  md:   "6px",   // buttons, inputs
  lg:   "8px",   // cards, panels, tables
  full: "9999px" // pills, avatars, dots
}
```

Fixed layout metrics: sidebar `w-60` (240px), top bar `h-14` (56px), control
height `h-8` (32px). No other one-off dimensions for chrome.

## 4. Component patterns

### Cards

- `bg-surface border border-border rounded-lg p-4`.
- No shadows anywhere — elevation is expressed with borders only.
- Card title: `text-base font-medium`, with optional `text-sm text-text-muted`
  description below; title block separated from body by `mb-3` or a
  `border-b border-border` header row (`px-4 py-3`) when the body is flush
  (e.g. contains a table).
- Stat cards: `text-xs uppercase text-text-muted` label, `text-lg
  font-semibold font-mono` value, optional delta line in
  `success`/`error`.

### Buttons

- Base: `h-8 px-3 rounded-md text-sm font-medium inline-flex items-center
  gap-2 transition-colors`.
- **Primary** — `bg-accent text-text hover:bg-accent-hover`. One per view max.
- **Secondary** — `bg-raised border border-border text-text
  hover:border-text-faint`.
- **Ghost** — `text-text-muted hover:text-text hover:bg-raised`.
- **Danger** — `bg-error-muted text-error border border-transparent
  hover:border-error`.
- Disabled: `opacity-50 pointer-events-none` (the one permitted opacity use).

### Tables

- Live flush inside a card: card has `p-0`, table spans full width.
- Header row: `bg-surface text-xs font-medium uppercase tracking-wider
  text-text-muted`, `px-4 py-3`, `border-b border-border`.
- Body rows: `px-4 py-3 text-sm`, separated by `border-b border-border`
  (last row borderless), `hover:bg-raised` when rows are clickable.
- Numeric columns right-aligned, `font-mono tabular-nums`.
- Row height stays compact — never add vertical padding beyond `py-3`.

### Badges / chips

- `inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium`.
- Tinted: muted background + solid text of the same hue, e.g.
  `bg-success-muted text-success` (YES), `bg-error-muted text-error` (NO),
  `bg-accent-muted text-accent` (category), `bg-raised text-text-muted`
  (neutral).

### Inputs

- `h-8 bg-raised border border-border rounded-md px-3 text-sm
  placeholder:text-text-faint focus:border-accent focus:outline-none`.

### Charts / data viz

- Lines and fills use only palette colors: `accent` for the primary series,
  `success`/`error` for directional series, `border` for gridlines and axes,
  `text-muted`/`text-faint` for axis labels (`text-xs`).

### Navigation

- Sidebar: `bg-bg border-r border-border`, items `h-8 px-3 rounded-md text-sm
  text-text-muted`, active item `bg-raised text-text`, hover
  `hover:text-text hover:bg-raised`.
- Top bar: `h-14 border-b border-border px-6`, page title `text-base
  font-medium` (page's `text-lg` title lives in the content area).
