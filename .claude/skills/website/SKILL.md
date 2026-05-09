---
name: website
description: |
  Make changes to the Yames landing page (docs/ folder). Ensures all changes are responsive
  and work on both desktop and mobile. Use when the user asks to update the website, landing
  page, add features to yames.app, or modify docs/index.html or docs/style.css.
metadata:
  author: a0d0oe0
sample-prompts:
  - "update the website with the new feature"
  - "add a section to the landing page"
  - "fix the mobile layout on yames.app"
  - "update the website styles"
---

# Website Changes — Responsive-First

## File Locations

- `docs/index.html` — Landing page HTML + inline `<script>` JS
- `docs/style.css` — All styles, CSS custom properties for theming
- `docs/img/` — Screenshots organized by view (metronome/, drill/, tapit/, zen/, widget/)

## Architecture

- **Single-page** static site hosted on GitHub Pages at `yames.app`
- **Theme-aware** — uses CSS custom properties: `--accent`, `--bg`, `--text`, `--text-dim`
- **Two-column layout** on desktop (`.content` left, `.showcase` right), stacked on mobile
- **Breakpoint**: `860px` is the main desktop/mobile split
- **GitHub API**: Fetches releases from `api.github.com/repos/turutupa/yames/releases` for download URLs and changelog

## Responsive Rules — MANDATORY

Every change to the website MUST be responsive. Follow these rules:

### 1. Always define both desktop and mobile behavior

For any new component or layout change:
- Define the **desktop** appearance (default or `@media (min-width: 861px)`)
- Define the **mobile** appearance (`@media (max-width: 860px)` or `@media (max-width: 600px)`)

### 2. If the user doesn't specify mobile behavior, ASK

Before implementing, ask the user:
> "How should this look on mobile? Options: (A) same as desktop, (B) hidden on mobile, (C) stacked/simplified, (D) fullscreen takeover, or describe your preference."

### 3. Key breakpoints

| Breakpoint | Usage |
|------------|-------|
| `860px` | Main layout: side-by-side → stacked |
| `600px` | Small mobile: modals go fullscreen, pills wrap |

### 4. Mobile patterns used in this project

- **Modals**: Go fullscreen (`100vw × 100vh`, no border-radius) below 600px
- **Flex containers**: Add `flex-wrap: wrap` for pill/button groups
- **Timeline/decorative elements**: Hidden on mobile (`display: none`)
- **Scrollbars**: Use thin themed scrollbar on mobile when native scroll is needed
- **Touch targets**: Minimum 44px tap targets on mobile

### 5. Testing

After making changes, test at both viewports:
- Desktop: 1280×800
- Mobile: 375×812 (iPhone viewport)

Use the browser tools to set viewport size and take screenshots at both sizes.

## Theme Integration

All colors must use CSS custom properties, never hardcoded colors:
- Backgrounds: `var(--bg)` or `color-mix(in srgb, var(--text) N%, transparent)`
- Text: `var(--text)`, `var(--text-dim)`
- Accent: `var(--accent)`, `color-mix(in srgb, var(--accent) N%, transparent)`
- Borders: `color-mix(in srgb, var(--text) 8-15%, transparent)`

## Existing Components Reference

| Component | Desktop | Mobile |
|-----------|---------|--------|
| Layout | Two-column side-by-side | Stacked, content on top |
| Download button | Standard size | Larger padding (20px 32px) |
| Platform pills | Single row | `flex-wrap: wrap` |
| Changelog modal | Centered, 620px wide, 70vh tall | Fullscreen 100vw×100vh |
| Timeline marks | Visible on right edge | Hidden |
| Theme/tab selectors | Horizontal row | Same (fits at 375px) |

## Conventions

- No external dependencies — pure HTML/CSS/JS
- Inline `<script>` tags at bottom of `index.html`
- CSS in separate `style.css` file
- Use `color-mix()` for transparency (no rgba with hardcoded colors)
- Font stack: system fonts via `inherit`
- Transitions: `0.15s ease` for interactions, `0.2s ease` for modals
