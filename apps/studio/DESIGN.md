# AgentV Studio Design System

> Studio is a dark, utility-driven dashboard for reviewing AI agent evaluation
> results. It favors dense tabular data, muted neutrals, and a single cyan
> accent over ornamental styling. Think "terminal inspector", not "marketing
> page". When in doubt, copy the pattern from `ExperimentsTab`, `TargetsTab`,
> `RunList`, or `PassRatePill` — they are canonical examples of the style.

## 1. Visual Theme & Atmosphere

AgentV Studio is a local evaluation dashboard for AI agent developers. The
design language is dense, dark, and data-first — this is a tool engineers
keep open in a second monitor while they iterate on prompts, not a page
they share on social. The canvas is near-black (`bg-gray-950`), elevated
surfaces sit one step up (`bg-gray-900`), and every interactive accent
pulls the eye toward the same cyan signal color (`cyan-400`).

Typography stays out of the way on purpose. A single system sans-serif
stack (`ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont`)
handles every piece of text. There is no brand display font, no serif,
no variable font. Numeric columns use `tabular-nums` so pass rates,
scores, and timestamps line up cleanly, and most table text sits at
`text-sm` (14px) with `font-medium` (500) reserved for row headers and
links.

Motion is almost absent. Rows fade in via Tailwind's built-in
`transition-colors`, the main tabs slide a 2px cyan underline indicator,
and that's it. There are no staggered entrance animations, no serif
display headings, no elevated box-shadows. Honor `prefers-reduced-motion`
if you add any animation.

**Key characteristics:**
- Dark canvas (`bg-gray-950`), elevated surfaces at `bg-gray-900/50` or `bg-gray-900`
- Single system sans-serif stack — no webfonts, no Google Fonts
- Cyan-400 is the ONE accent for interactive elements and links
- Emerald/yellow/red tones for pass/warn/fail, used sparingly and only for data
- Blue gradient reserved for `PassRatePill` (the one exception to cyan monopoly)
- Rounded corners: consistently `rounded-lg` (8px) for containers, `rounded-md` (6px) for inputs/buttons, `rounded-full` for pills
- Hairline borders (`border-gray-800`), never shadows

## 2. Color Palette & Roles

### Surfaces

| Token | Hex (Tailwind) | Role |
|---|---|---|
| `bg-gray-950` | `#030712` | App canvas / body background |
| `bg-gray-900` | `#111827` | Elevated container background |
| `bg-gray-900/50` | `#111827` @ 50% | Table header row, subtle fills |
| `bg-gray-900/30` | `#111827` @ 30% | Row hover state |
| `bg-gray-800` | `#1f2937` | Secondary button fill, progress track, skeleton bars |
| `bg-gray-800/50` | `#1f2937` @ 50% | Divider, disabled fill |

### Borders

| Token | Role |
|---|---|
| `border-gray-800` | Default container borders (every `rounded-lg` card + table wrap) |
| `border-gray-800/50` | `divide-y` row separators inside tables |
| `border-gray-700` | Form input borders |
| `border-cyan-900/60` | Label/tag chip borders — the only cyan-tinted border |
| `border-red-900/60` | Error / destructive action borders |

### Text

| Token | Role |
|---|---|
| `text-gray-100` | Default body text on `bg-gray-950` |
| `text-white` | Section headings (`h2 text-xl font-semibold`) |
| `text-gray-200` | Row primary values (target name, timestamp) |
| `text-gray-300` | Secondary values inside cells |
| `text-gray-400` | Table header labels, section subtitles, muted links |
| `text-gray-500` | Metadata, timestamps, "N runs" counts |
| `text-gray-600` | Placeholders, empty-state em-dashes |

### Accent (single source of truth: cyan)

| Token | Role |
|---|---|
| `text-cyan-400` | Active tab, links, primary-action emphasis |
| `text-cyan-300` | Link/tag hover, label chip text |
| `text-cyan-500` | Accent on focused checkbox/select |
| `bg-cyan-500` | Primary action button fill (e.g. "Compare N", "Save") |
| `bg-cyan-400` | Primary button hover |
| `bg-cyan-950/30` | Tag chip fill, selected-row tint |
| `bg-cyan-950/20` | Selected-row tint on per-run list |
| `ring-cyan-500` | Focus ring on inputs and buttons |

**Rule:** do not introduce a second accent. Green, amber, and red are
reserved for **data tones** (pass/warn/fail), not for interactive UI.

### Data tones

| Token | Role |
|---|---|
| `text-emerald-400` / `bg-emerald-400` | Pass (≥80%), success dots, "passed" count numerator |
| `text-yellow-400` / `bg-yellow-400` | Warn (50–80%) |
| `text-amber-400` | Run source badge for `remote` runs |
| `text-red-400` / `bg-red-400` | Fail (<50%), error text, destructive button |
| `bg-red-950/30` + `border-red-900/60` | Error banners and destructive button hover |

### The blue-gradient exception

`PassRatePill` is the one place blue (not cyan) appears — a fixed
`bg-gradient-to-r from-blue-400 to-blue-600` fill on a `bg-gray-800`
rounded-full track. This is the recognizable "Studio pill" that ties
the Runs, Experiments, Targets, and Compare tabs together. Reuse it
verbatim (`<PassRatePill rate={0.75} />`) — do not recreate it with
cyan or with a different gradient.

## 3. Typography Rules

### Font stack

One stack, applied globally in `src/styles/globals.css`:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
             "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

No webfonts. No display font. No second family for code or data — use
`tabular-nums` for numeric alignment, not a monospace font.

### Hierarchy

| Role | Class | Notes |
|---|---|---|
| Page title | `text-2xl font-semibold text-white` | Top-level section (e.g. "Evaluation Runs") |
| Section title | `text-xl font-semibold text-white` | Tab headings (e.g. "Compare runs") |
| Sub-section | `text-lg font-medium text-gray-300` | Inside-card headers |
| Table header | `font-medium text-gray-400 px-4 py-3` | Column labels; NOT uppercase by default |
| Table header (micro) | `text-xs uppercase tracking-wider text-gray-500` | Only for eyebrows / sub-headers |
| Row primary | `font-medium text-gray-200` | Main row identifier (target, timestamp) |
| Row numeric | `tabular-nums text-gray-400` | Every number in every cell |
| Body text | `text-sm text-gray-300` | Default inside cards |
| Body muted | `text-sm text-gray-400` | Subtitles, explanatory text |
| Caption | `text-xs text-gray-500` | Metadata, run ids, hint text |
| Link | `text-cyan-400 hover:text-cyan-300 hover:underline` | Internal navigation |

### Principles

- **`text-sm` is the default.** Most table text, most body text, most
  buttons. `text-base` (16px) is reserved for empty-state headlines.
- **`font-medium` (500), not bold.** 600 for section titles, never 700.
- **`tabular-nums` on every number.** Pass rates, scores, test counts,
  timestamps, avg values. The columns must line up.
- **No uppercase headers by default.** Only use `uppercase tracking-wider`
  for tiny eyebrow labels (`text-xs uppercase tracking-wider text-gray-500`).
- **No custom line-heights.** Tailwind's defaults work.

## 4. Component Stylings

### Containers

```tsx
<div className="overflow-hidden rounded-lg border border-gray-800">
  {/* … */}
</div>
```

Every meaningful grouping goes in a `rounded-lg` bordered container.
No drop shadows, no inner glows. The border itself IS the elevation.

### Tables

Canonical pattern (from `ExperimentsTab.tsx` — copy this verbatim):

```tsx
<div className="overflow-hidden rounded-lg border border-gray-800">
  <table className="w-full text-left text-sm">
    <thead className="border-b border-gray-800 bg-gray-900/50">
      <tr>
        <th className="px-4 py-3 font-medium text-gray-400">Column</th>
        <th className="px-4 py-3 text-right font-medium text-gray-400">Number</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-800/50">
      <tr className="transition-colors hover:bg-gray-900/30">
        <td className="px-4 py-3">…</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-400">…</td>
      </tr>
    </tbody>
  </table>
</div>
```

- **Padding:** `px-4 py-3` for every cell (both header and body).
- **Rows:** `divide-y divide-gray-800/50` + `hover:bg-gray-900/30`.
- **Right-align numbers:** `text-right tabular-nums`.

### Buttons

| Variant | Classes | Use |
|---|---|---|
| Primary | `rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500` | "Save", "Compare N", main submit actions |
| Ghost | `rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:text-gray-200` | Cancel, inline Clear, low-stakes secondary |
| Destructive | `rounded-md border border-red-900/60 px-3 py-1.5 text-sm text-red-400 transition-colors hover:border-red-800 hover:bg-red-950/30 hover:text-red-300` | Clear all, delete, destructive |
| Emerald (rare) | `rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500` | Reserved for "Run Eval" only — NOT a general accent |

Primary buttons use `text-gray-950` (not white) on cyan-500 because
cyan-500 is a bright background and dark foreground contrasts better.

### Inputs

```tsx
<input
  className="rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
/>
```

- `bg-gray-950` (inset, darker than surrounding `bg-gray-900`)
- Focus uses `ring-1 ring-cyan-500` + matching `border-cyan-500` — always both together.
- Disabled is `opacity-50`, not a different fill.

### Pill chips (tags, labels, status badges)

```tsx
<span className="rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300">
  {tag}
</span>
```

- `rounded-md` (6px), not `rounded-full`
- Always three tokens together: `border-cyan-900/60 bg-cyan-950/30 text-cyan-300`
- `text-xs` (12px), `font-medium`

For status badges (local/remote source pill, pass rate chip), swap the
cyan trio for emerald (`emerald-900/60` + `emerald-950/30` + `emerald-300`)
or amber (`amber-900/60` + `amber-950/30` + `amber-300`).

### `PassRatePill` (always reuse the component)

```tsx
import { PassRatePill } from './PassRatePill';
<PassRatePill rate={0.75} />
```

Never recreate this inline — import the shared component. Width is
fixed at `w-20`, height at `h-5`, fill is the only Studio element that
uses the blue gradient.

### Mode toggle / segmented control

```tsx
<div
  role="tablist"
  className="inline-flex items-center rounded-lg border border-gray-800 bg-gray-900/50 p-1"
>
  <button
    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? 'bg-gray-800 text-cyan-400 shadow-sm' : 'text-gray-400 hover:text-gray-200'
    }`}
  >
    Option
  </button>
</div>
```

Used in `CompareTab` for the Aggregated / Per-run switch. Do not use a
2px underline indicator here — that pattern is reserved for the **main
page tabs** (see Navigation below).

### Main page tabs

The top-level tab strip (`Recent Runs`, `Experiments`, `Compare`,
`Targets`) uses a 2px underline indicator:

```tsx
<button
  className={`px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? 'border-b-2 border-cyan-400 text-cyan-400'
      : 'text-gray-400 hover:text-gray-300'
  }`}
>
```

Reserve this pattern for main navigation only. Use the segmented-control
pattern above for in-view mode switches.

## 5. Layout Principles

### Spacing

- Vertical rhythm between stacked sections: `space-y-6` (24px) for top-level, `space-y-4` (16px) mid-level, `space-y-3` (12px) inside cards, `space-y-2` (8px) inside form rows.
- Horizontal gutters between adjacent buttons/chips: `gap-2` (8px) default, `gap-3` (12px) when elements are larger.
- Card internal padding: `p-4` (16px) default, `p-8` (32px) for empty states, `p-3` (12px) for inline editors.
- Cell padding: always `px-4 py-3` for table cells.

### Container strategy

- Main content lives in `<main className="…">` inside `Layout.tsx`. Don't add your own page-level backgrounds — inherit `bg-gray-950` from `<body>`.
- Sidebar is fixed-width (`w-56` / `w-64`), `border-r border-gray-800`.
- No max-width container — Studio fills the viewport. Tables scroll horizontally with `overflow-x-auto` on their wrap.

### Whitespace philosophy

- **Density over air.** Studio is an inspector, not a blog post. Use
  `py-3` on table rows, not `py-6`. Use `space-y-4` between sections,
  not `space-y-10`.
- **Borders, not margins.** Separate groups with `border-b border-gray-800`
  or `divide-y divide-gray-800/50` rather than large vertical gaps.
- **Empty states get room.** The only place to use generous padding is
  the empty-state notice (`rounded-lg border border-gray-800 bg-gray-900 p-8 text-center`).

### Border radius scale

- `rounded` (4px): chips' inner bits, small indicators
- `rounded-md` (6px): buttons, inputs, chips, in-view toggles
- `rounded-lg` (8px): every container, every card, every table wrap
- `rounded-full`: checkboxes, the `PassRatePill` track, legend swatches

**Never `rounded-xl` or `rounded-2xl`.** 8px is the ceiling for containers.

## 6. Depth & Elevation

Studio is flat. There are almost no shadows.

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow | Default for everything |
| Subtle border | `border border-gray-800` | Every container's "elevation" |
| Focus ring | `focus:ring-1 focus:ring-cyan-500` | Focused inputs/buttons only |
| Drop shadow | `shadow-xl` | RARE — only floating elements like the sticky compare action bar or a modal |

**Shadow philosophy:** borders carry elevation. When you think "this needs
to stand out", darken or lighten the surface (`bg-gray-900` → `bg-gray-800`)
instead of adding a shadow. The one exception is sticky action bars and
modals, which can use `shadow-xl backdrop-blur` over a translucent
`bg-gray-900/95` background.

## 7. Do's and Don'ts

### Do

- Copy patterns verbatim from `ExperimentsTab.tsx`, `TargetsTab.tsx`, `RunList.tsx`, and `PassRatePill.tsx` before inventing new ones.
- Use `tabular-nums` on every number.
- Use `<PassRatePill />` wherever you show a 0–1 rate.
- Wrap every meaningful grouping in `rounded-lg border border-gray-800`.
- Use `transition-colors` for hovers, nothing else.
- Use `font-medium` (500) for headings — 600 is a ceiling for section titles.
- Align numbers right, identifiers left.
- Honor `prefers-reduced-motion` if you add any animation.
- Pass `readOnly` through when your surface writes data — some Studio deployments run in leaderboard mode.

### Don't

- Don't introduce a second accent color. Cyan is the ONLY interactive accent. Use emerald/amber/red for data tones only.
- Don't add webfonts (no Fraunces, Inter, JetBrains Mono, or Google Fonts of any kind).
- Don't use drop shadows for elevation. Borders do that job.
- Don't use `rounded-xl` or larger. 8px is the ceiling.
- Don't use `font-bold` (700) for headings. 500–600 is the range.
- Don't recreate `PassRatePill` inline. Import the component.
- Don't nest `rounded-lg` containers inside each other more than one level deep. Studio is flat.
- Don't use uppercase on normal table headers. `tracking-wider uppercase` is reserved for eyebrow labels only.
- Don't put colored backgrounds on tables or main content areas. The canvas stays `bg-gray-950`.
- Don't set your own `font-family` on a subtree. Inherit the global system stack.

## 8. Responsive Behavior

Studio targets desktop primarily (developers with second monitors). Mobile
layout is best-effort.

### Breakpoints (Tailwind defaults)

| Name | Tailwind | Behavior |
|---|---|---|
| Mobile | `<640px` | Sidebar collapses; tables scroll horizontally via `overflow-x-auto` |
| Tablet | `sm:` / `md:` | Full layout, narrower gutters |
| Desktop | `lg:` / `xl:` | Full layout, expanded gutters |

### Collapsing strategy

- Tables always wrap in `overflow-x-auto` — let wide tables scroll horizontally rather than restacking columns.
- Side-by-side compare view keeps the first column sticky (`sticky left-0 z-10 bg-gray-950/70 backdrop-blur`) so test names stay visible.
- Flex containers with `flex-wrap` gracefully collapse multi-chip sets (tags, legend swatches).

## 9. Agent Prompt Guide

### Quick color reference

- Canvas: `bg-gray-950`
- Elevated surface: `bg-gray-900` or `bg-gray-900/50`
- Border: `border-gray-800`
- Body text: `text-gray-300` / `text-gray-400`
- Heading: `text-white`
- Accent (everything interactive): `cyan-400` / `cyan-500`
- Pass / warn / fail: `emerald-400` / `yellow-400` / `red-400`
- Destructive: `red-400` + `border-red-900/60`

### Example prompts

- **Table section**: "Create a table section on `bg-gray-950`. Wrap in `overflow-hidden rounded-lg border border-gray-800`. Header row `border-b border-gray-800 bg-gray-900/50` with `font-medium text-gray-400` column labels at `px-4 py-3`. Body `divide-y divide-gray-800/50`, rows `transition-colors hover:bg-gray-900/30`. Numeric columns right-aligned with `tabular-nums text-gray-400`. Reuse `<PassRatePill rate={value} />` for any 0–1 rate column."

- **Primary action**: "Place a primary button aligned right: `rounded-md bg-cyan-500 px-3 py-1.5 text-sm font-medium text-gray-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500`. Text label in the button should be imperative — Save, Compare N, Apply — not 'Click here'."

- **In-view toggle**: "Build a segmented control: `inline-flex items-center rounded-lg border border-gray-800 bg-gray-900/50 p-1`. Each button `rounded-md px-3 py-1.5 text-sm font-medium transition-colors`, active state `bg-gray-800 text-cyan-400 shadow-sm`, inactive `text-gray-400 hover:text-gray-200`. Give it `role=\"tablist\"` and `aria-selected` on the active button."

- **Tag chip**: "Render a tag chip: `rounded-md border border-cyan-900/60 bg-cyan-950/30 px-2 py-0.5 text-xs font-medium text-cyan-300`. If editable, nest a remove button inside: `text-cyan-500 transition-colors hover:text-cyan-200 disabled:opacity-50` with aria-label describing the removal."

- **Empty state**: "Show an empty state: `rounded-lg border border-gray-800 bg-gray-900 p-8 text-center`. Headline `text-lg text-gray-300`, body `mt-2 text-sm text-gray-500`. Don't add an illustration or accent color — the message and layout do all the work."

- **Input row**: "Build a form row: label above at `text-xs font-medium uppercase tracking-wider text-gray-400`. Input: `rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50`. Right-align action buttons at the end of the row with `gap-2`."

### Iteration guide

1. Start from an existing Studio component and copy its classNames verbatim. Only diverge when you need to.
2. If you want to emphasize something, darken or lighten the surface — don't add a shadow, don't add an accent colour, don't scale the type.
3. Use cyan-400 exclusively for interactive state. If you feel the urge to add a second accent, use a data tone (emerald/yellow/red) and only for data.
4. Every number gets `tabular-nums`. Every rate gets `<PassRatePill />`.
5. When you think "this needs more air", stop — Studio is dense by design. Tables are `py-3` rows, not `py-6`.
6. When you think "this needs a hero headline", stop — Studio doesn't do heroes. Section titles are `text-xl font-semibold text-white` and nothing else.
