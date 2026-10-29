# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DexVault is a web app for managing physical media collections (movies, music, books). It uses a React frontend with a Node.js/Express backend, SQLite database, and enriches data from external APIs (TMDB, OMDB, MusicBrainz).

## Commands

```bash
# Install all dependencies (root + frontend + backend)
npm run install:all

# Development (runs frontend on :3000 and backend on :3001 concurrently with hot reload)
npm run dev

# Build
npm run build:dev    # development build
npm run build:prod   # production build

# Run built app
npm start            # runs dist/start.sh

# Backend tests (offline, no LLM)
cd backend && npm test
# Evalsets: score the vision model against the live LLM server (and TMDB with TMDB_API_KEY); never part of npm test
cd backend && npm run eval

# Frontend tests
cd frontend && npx vitest              # interactive watch mode
cd frontend && npx vitest --run        # single run
cd frontend && npx vitest --run ComponentName  # single test file
```

## Architecture

**Monorepo with three package.json files:** root (orchestration/dev tooling), `frontend/` (React Vite app), `backend/` (Express API server). Fully TypeScript.

### Backend (`backend/`)
- **Express 5** server with SQLite3 database
- MVC pattern: `src/controllers/` → `src/services/` → `src/models/`
- Controllers: movie, music, book, analytics, backfill, backup, bookComment
- External API integrations: `tmdbService`, `omdbService`, `musicbrainzService`, `bookApiService`, `bookImslpService`
- Image handling: `imageService` (download/storage), `posterService` (movie posters), `bookCoverService`
- Database migrations in `backend/migrations/` and inline in `src/database.ts` (`runAutoMigrations`)
- Config hierarchy: `deployment.{dev,prod}.json` → `data/options.json` → environment variables
- Data directory (`data/`) holds `db.sqlite`, `options.json`, and `images/` — mounted as volume in Docker

### Frontend (`frontend/`)
- **React 19** with Vite, React Router 7, React Bootstrap, react-icons
- Main app shell in `App.tsx` — manages search state, navigation pills, and routing
- Pages: FilmDexPage (movies), MusicDexPage, BookDexPage, WishListPage, AnalyticsPage, BackupPage
- Shared collection components in `components/shared/` (CollectionGrid, CollectionHeader, NextBanner, EmptyState)
- Service layer in `services/` — `api.ts` (movies/general), `musicService.ts`, `bookService.ts`, `bookCommentService.ts`, `backupService.ts`
- Frontend proxies API calls to backend via Vite proxy config in dev mode

### Build System
- `build.js` — custom Node.js build script that assembles `dist/` with frontend build, backend source, Dockerfile, start script, and version info

### Design guidelines
**Read `docs/design-guidelines.md` before writing any UI**: the principles (one material, gold means on, one gold action per window, red never gold), the colours, and which shared component to use for what. The sections below are its short form.

### On covers, posters and books' covers: CoverTag and CoverButton
Everything laid over an image (an album cover, a movie poster, a book cover) uses the shared components in `frontend/src/components/shared/`; never style a tag or a button on an image by hand.
- **`CoverTag`** (`variant`: plain, gold, orange, muted, alert, on) for a tag: square-cornered, small capitals, dark glass with a light edge, its meaning in the colour of its words. Several together go in a **`CoverTagStack`** (a column of one width, at least 38px; or `direction="row"`).
- **`CoverButton`** (`label`, `active`, `size`: small/normal/large, `reveal`: hover/dim/always) for a round button: dark glass, a white ring under the pointer, plain gold with a dark icon when `active`. A button with `reveal="hover"` shows while the card holding it, which carries the class `cover-host`, is hovered. A `Menu` takes it as its trigger: `trigger={props => <CoverButton {...props} … />}`.
- The look lives in `shared/cover.css` alone. A component's own stylesheet only places a tag or a button in its corner (position, z-index), nothing else.
- Gold means "on" or "to do" (wished, to buy, in Listen/Watch Next, playing), red an alert (spiders, snakes, a book lent), orange a copy to do again.

### Menus: Menu
Every menu that opens from a button uses **`Menu`** (`frontend/src/components/shared/Menu.tsx`, look in `shared/menu.css`): never a react-bootstrap `Dropdown`, never a panel by hand.
- `trigger={(props, open) => <button {...props} …/>}`: spread the props, ref included, on any button (a `menu-pill`, a `CoverButton`, a Bootstrap `Button`); `MenuChevron` shows a turning chevron. `align` start/end, `drop` down/up (it flips when there is no room), `matchWidth` for a field.
- Entries: `Menu.Item` (an action: `icon`, `hint`, `danger`, `disabled`), `Menu.Choice` (one of several: `selected` wears a gold ✓), `Menu.Section` (a small-capitals title), `Menu.Separator`.
- The covers' dark glass, blurred; a light veil under the pointer or the keys; gold only for the choice made, red for danger. In a modal it lies in the modal, which keeps the focus.
- A form's list is **`Select`** (`shared/Select.tsx`), never a `<select>` or a `Form.Select`: the same `<option>`s and `<optgroup>`s as children, the same `onChange(event)` (`event.target.value`, `event.target.name`), `size`, and in a `Form.Group` its `controlId`. Closed it is a field like the others (`ui-input`; `bare` keeps its own class instead), open a `Menu`; on an iPhone or iPad the system's own select. In tests, `frontend/src/test/select.ts` reads and chooses its value.

### Fields: TextField and TextArea
Every field uses **`TextField`** (one line) or **`TextArea`** (`frontend/src/components/shared/TextField.tsx`, look in `shared/field.css`): never a `Form.Control`, a `form-control` class or an `<input>` styled by hand (a checkbox, a radio, a file stay as they are).
- The props of an `<input>`, its `ref`; `size` md (36 px, a form) or sm (28 px, a bar, an edit in place), `isInvalid` (red edge), `icon` before the words, `suffix` after; in a `Form.Group` its `controlId`. Under it `<FieldError>` (only when it has something to say) and `<FieldHint>`.
- Suggestions under a field wear the menus' glass: `menu-surface` and `menu-item` (`menu-item--active` for the one the keys are on).
- An edit in place with its ✓ ✕ over the field: a parent of its own, never Bootstrap's `input-group` (it squares the right corners).
- A stylesheet only places a field, never its background, edge, padding, height or font size.

### Notices and toasts: Notice and toast()
A word in a window or on a page is **`Notice`** (`frontend/src/components/shared/Notice.tsx`, look in `shared/notice.css`); a word that passes is **`toast(message, { tone, action, duration })`** (`shared/Toast.tsx`, `ToastHost` mounted once in `App.tsx`). Never a react-bootstrap `Alert`, an `alert alert-*` class, or a box or a floating alert of a page's own.
- `tone`: info (grey, the default), success (a gold ✓), warning (orange, `--dv-orange`), danger (red). No blue, no green.
- `Notice`: dark glass with a stripe of its tone; `title`, `action` (a small `Button`), `onClose` (a ✕). A toast: the menus' glass, at the bottom above the player, gone after 6 s, an `action` (Undo) in gold; `toneOf(type)` reads the old `onShowAlert(message, type)` types.

### Waits: Spinner and Loading
A wait is **`Spinner`** (`frontend/src/components/shared/Spinner.tsx`, look in `shared/spinner.css`; `size` sm 12 px, md 16 px, lg 32 px) and a page or a section that loads is **`<Loading>words…</Loading>`**: never `spinner-border`, a react-bootstrap `Spinner` or a spinner of a stylesheet's own. Grey on its own, the colour of what it stands in for in a button, a field or on a cover; a `Button` that waits takes `loading`. Centre it with flex or a margin, never a `translate`, which its turn undoes.

### Buttons: Button and IconButton
Every button uses **`Button`** or **`IconButton`** (`frontend/src/components/shared/Button.tsx`, look in `shared/button.css`): never a react-bootstrap `Button`, a `btn` class or a button styled by hand. On covers, `CoverButton` stays.
- `Button` `variant`: **primary** (plain gold, the one action a window is for: one per window), **secondary** (the default: the menus' glass), **quiet** (words alone: Cancel, See more), **danger** (red; a destructive action never takes the gold, and in a confirmation it stands where the gold would). `size` sm/md, `icon` before the words, `loading` (a spinner, no second click), `active` for a toggle that is on (gold words; on `danger`, plain red: a deletion to confirm), `block`.
- `IconButton`: an icon alone, `label` required (tooltip and screen readers), `size` sm/md, `tone` confirm (gold ✓ beside a field) or danger, `boxed` when it stands alone in a bar, `active`.
- Side by side as one (Play and its ▾): a parent with the class `ui-button-group` (or a Bootstrap `ButtonGroup`); the ▾ takes the class `ui-button--split` and a `MenuChevron`.
- A dialog is **`Dialog`** (`Dialog.Body`, `Dialog.Footer`; `variant` center or panel, the head of an album's card with `icon`, `title`, `aside`, `steps`, ✕), never a react-bootstrap `Modal` or an overlay by hand; a question is `await confirm({ … })`, never `window.confirm`.
- On an iPhone the page runs under the status bar and the home indicator: every `.modal` keeps clear of them by itself (`App.css`); anything else that touches an edge of the screen pads itself with `--safe-top`, `--safe-right`, `--safe-left`, `--safe-foot`.
- One of a few side by side is **`Segmented`**; a filter pill, a shelf to jump to or a filter in place with its ✕ is **`Chip`** (see the guidelines).
- A component's stylesheet only places a button (margins, position, flex), never its colours, borders, padding or size.

### Stars: StarRating
The owner's stars on an album or a book are **`StarRating`** (`frontend/src/components/shared/StarRating.tsx`, look in `shared/star-rating.css`): by halves, `value`, `onChange(stars)` (0 takes them away), `size` sm/md/lg. Gold and flat, no glow; under the pointer white for what a click adds, pale gold for what it takes away. Never the focus (the arrows go from record to record). An album's half goes to Navidrome rounded. Under a finger (iPhone, iPad) it is a dial instead: a large counter in the middle of the screen, the finger up for more, down for less, by halves, from the stars given or from a grey 3 for none (gold once the finger moves); let go, they are given, back on the stars given or down to none on a record of none nothing. An album's stars are **`AlbumStarRating`**, a book's **`BookStarRating`** (`components/RecordStarRating.tsx`), never a bare `StarRating`: the same, its dial saying what the stars mean (Not for me … Glad I have it, Glad I read it at 3 … Outstanding) and what share of the rated albums or books holds as many.

### Tooltips and choices: title, TooltipHost, check.css
A tooltip is a plain **`title="…"`**: the **`TooltipHost`** (`frontend/src/components/shared/Tooltip.tsx`, look in `shared/tooltip.css`), mounted once in `App.tsx`, shows it in the menus' glass, just under the pointer, after 250 ms, at once after another one, and lifts the title off while it is pointed at so the system's tooltip never shows. Never a react-bootstrap `OverlayTrigger`/`Tooltip` or a bubble of a stylesheet's own.
A radio or a checkbox (a `Form.Check`, or a bare `<input type="radio">`/checkbox) wears **`shared/check.css`**, imported after Bootstrap in `App.tsx`: dark glass, a gold dot or a gold box with a dark ✓ when on. A stylesheet only places one, never its colours or size; a switch of its own (Stack, Digital) hides its input and keeps its look.

### Key Patterns
- Each media type (movie, music, book) follows the same layered pattern: controller → service → model, with a corresponding frontend page, detail card, search component, and API service
- Collections/box sets are shared across media types via `collection` and `movieCollection`/`albumCollection` models
- Smart playlists and "Listen/Watch Next" features use `smartPlaylistService` and `playlistHistory` model
