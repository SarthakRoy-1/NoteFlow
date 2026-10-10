# Design System

> Documents the implemented interface. Source of truth in code: `frontend/src/styles/tokens.css`
> (tokens) and `frontend/src/styles/global.css` (components). Product context: `PRODUCT.md`.

## Direction: a quiet desk

NoteFlow is a writing product first. The interface is warm paper and ink: content leads, chrome
recedes, and the only colour that carries meaning is used for exactly one meaning each.

- **Paper** surfaces, **ink** text, **hairline** rules instead of cards.
- **Pen green**: actions, links, focus, active state.
- **Marker yellow**: anything the AI made (the "AI" mark, "AI-created", highlighted phrases on the
  login example). Never used for status.
- **Brick red**: overdue, due now, errors, destructive actions. Nothing else.

Avoid: indigo/purple actions, rounded cards around everything, pill badges, dashed empty states,
decorative gradients and shadows, centred single-card screens.

## Tokens (`tokens.css`)

Every colour is one `light-dark()` declaration, so light and dark share a single palette. The theme
setting only sets `color-scheme` (`data-theme="light|dark"` on `<html>`, absent = follow the device).

| Token                              | Light     | Role                                    |
| ---------------------------------- | --------- | --------------------------------------- |
| `--paper`                          | `#fbf8f2` | Page and editor surface                 |
| `--paper-sunk`                     | `#f4efe4` | Sidebar, note list, hover/selected rows |
| `--paper-raised`                   | `#fffdf9` | Inputs, login example note              |
| `--ink` / `--ink-2` / `--ink-3`    | `#211d18` 15.8:1, `#5a5246` 7.3:1, `#6f6659` 5.3:1 (4.9:1 on sunk) | Text, secondary, metadata |
| `--rule` / `--rule-strong`         | `#e6dece` / `#d3c8b2` | Hairlines, control borders |
| `--pen`, `--pen-hover`, `--on-pen` | `#2d5a4a`  | Primary action                          |
| `--marker`, `--marker-ink`         | `#f4df8e`  | AI-made marks                           |
| `--brick`, `--brick-wash`, `--brick-rule`, `--on-brick` | `#a5321d` | Overdue, due now, errors |

Dark values are the second argument of each `light-dark()`: warm charcoal `#181611`, ink `#ede7da`,
pen `#8cc4ad`, brick `#ee9680`.

## Typography

- **Display and reading: Newsreader Variable** (self-hosted via `@fontsource-variable`): headings,
  note titles and bodies (19px / 1.7, 66ch measure), Ask AI questions and answers.
- **Interface: Instrument Sans Variable**: navigation, controls, metadata.
- Scale: 15 / 18 / 22 / 34px (`--step-0…3`), page titles 34px with -0.025em tracking, `text-wrap:
balance` on headings. Dates and counts use tabular numerals.

## Layout

- **Desktop (>1100px):** 236px sidebar (wordmark, four nav items with drawn 1.6px-stroke icons,
  account and sign out at the foot). Notes: 340px list + reading/writing pane. Other pages: left-aligned
  column, max 920px.
- **Tablet (≤1100px):** narrower sidebar and list; ≤820px the sidebar becomes a top bar and a bottom tab
  bar, Notes stays two-pane down to 600px.
- **Phone (≤600px):** Notes is one pane at a time with a back link; row actions sit under the row.
  ≤720px the login stacks.

## Components

- **Rows, not cards.** Notes, todos, reminders, history entries and sources are rows divided by
  hairlines. The only bordered surfaces are inputs, the edit-in-place form, the Ask composer, and the
  failed-analysis notice.
- **Buttons:** 34px, 6px radius. Primary = pen fill; default = hairline outline; danger-outline =
  brick text. Row actions (Edit/Delete) are quiet text, revealed on hover/focus, always visible on touch.
- **Note editor:** the form is the page. Title and body are borderless serif fields (labels remain for
  assistive tech), a hairline separates the actions.
- **Todo:** 20px circular check (pen when done), title, meta line (due, AI mark, source note). Overdue
  due text is brick and bold; done items are struck through in `--ink-3`.
- **Reminder:** sections Due now / Upcoming / No time set / Acknowledged. A due row gets a brick wash and
  dot; acknowledged rows are muted. The in-app alert is a full-width brick-wash band above every page.
- **Ask AI:** a writing-surface composer; the question is shown as an italic serif line, the answer as
  reading prose, then "Sources used" as real links. "Not enough information" is a marker-highlighted
  line. History is a quiet list at the right (below the composer on small screens).
- **Settings:** label-left / control-right rows divided by hairlines: Account, Time zone, Appearance
  (System / Light / Dark segmented control, saved in `localStorage`).
- **Login:** (the email form, Sign in / Create account switch and email-link pages below appear only when `ENABLE_PASSWORD_AUTH=true`; by default the page shows just the Google button) two columns: wordmark, a serif statement, a Sign in / Create account switch, the Google button and an email form (name, email, password with show/hide); after sign-up the form becomes a "Check your email" panel with a resend button. Pages reached from email links (confirm email, forgot and reset password) use the same paper column with the wordmark above a serif title, and Settings has a "Sign-in methods" row. Sign-up and recovery are hidden when the server cannot send email. Beside it a worked example of
  how a note becomes a reminder and a todo (illustrative, labelled as an example, hidden from
  assistive tech).

## Motion

Ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, 140ms for state changes, 260ms for entrances. Press scale
0.97 on buttons and nav. Hover styles are gated by `(hover: hover)`. One entrance per screen change,
the reminder band drops in, and the login example's highlights sweep once. `prefers-reduced-motion`
collapses all of it.

## Accessibility

Visible 2px pen focus ring on `:focus-visible`; computed contrast ≥4.9:1 for every text/background pair in both themes; every icon is
decorative with a text label beside it; checkbox, radio and select controls are native elements.
