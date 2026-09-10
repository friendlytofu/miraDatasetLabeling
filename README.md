# Mira Dataset Studio

A small internal tool for expanding the Mira offer/want matching training set:
draft offer/want phrasings from plain-language activity descriptions, generate
balanced non-repeating 1–3-offer × 1–3-want combinations, label them yes/no
and export in the exact training-data JSON format.

Static frontend (`index.html`, `style.css`, `app.js`) + Cloudflare Pages
Functions (`/functions/api/*`) + a Cloudflare D1 database for storage.

## Access password

The whole app (pages *and* the `/api/*` routes) sits behind a shared
password, enforced server-side in `functions/_middleware.js` — not just a
client-side popup. Session cookies are signed, random, time-bounded bearer tokens. The default password is **`mira`**.

To change it, set a `MIRA_PASSWORD` environment variable/secret on the
Pages project (Settings → Environment variables) instead of editing the
code:

```bash
wrangler pages secret put MIRA_PASSWORD
```

If `MIRA_PASSWORD` isn't set, it falls back to `mira`. Visiting the site
redirects to `/login.html`; a correct password sets an `HttpOnly` session
cookie (valid 30 days) via `POST /api/login`. `POST /api/logout` clears it
— there's a "Log out" button in the header.

## 1. Create the D1 database

```bash
npm install -g wrangler   # if you don't have it
wrangler login
wrangler d1 create mira-labeling-db
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Apply the schema:

```bash
wrangler d1 execute mira-labeling-db --remote --file=./schema.sql
```

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Mira dataset studio"
git branch -M main
git remote add origin https://github.com/<your-username>/mira-labeling.git
git push -u origin main
```

## 3. Connect to Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick this repo.
2. Build settings: framework preset **None**, build command **empty**,
   build output directory **`/`** (repo root — there's no build step).
3. After the first deploy, go to the Pages project → **Settings** →
   **Functions** → **D1 database bindings** → add a binding:
   - Variable name: `DB`
   - D1 database: `mira-labeling-db`
4. Redeploy (Settings → Deployments → retry, or push a commit) so the
   Function picks up the binding.

Your site is now live at `https://<project-name>.pages.dev`, with the API
routes under `/api/*` served by the same deployment.

## Local development

```bash
wrangler d1 execute mira-labeling-db --local --file=./schema.sql
wrangler pages dev . --d1=DB=mira-labeling-db
```

## How it's organized

- **Create** — type an activity ("organic chemistry tutoring"), the app
  drafts an offer phrasing and a want phrasing from simple templates (cycle
  through alternates with "try another phrasing"), you edit and save either
  or both into the item bank.
- **Generate** — draws random, non-repeating combinations of 1–3 offers and
  1–3 wants from the bank, round-robining across all nine size buckets
  (1×1 … 3×3) so the queue stays balanced. Uniqueness is enforced by a
  `combo_key` (sorted item ids) so the same exact combination is never
  queued twice.
  (via the free MyMemory API, cached in D1 so repeats are instant) and
  shared-word highlighting across the offer/want texts are both there to
  speed up reading. "Match" / "No match" writes `human_label`, the current
  labeler name (persisted in the browser), `labeled_blind: true`, and a
  real timestamp captured at click time in the labeler's own local time
  zone.
- **Export** — downloads every labeled entry as JSONL, one compact JSON object per line, with `id` renumbered sequentially from 0.

## What's new in this version

- **More phrasing variety** — 9 offer and 9 want templates per activity
  instead of 3; "shuffle phrasing" now jumps to a random alternative (never
  repeating the one you're already looking at) and shows how many variants
  are left, e.g. `(4/9)`.
- **Keyboard shortcuts while labeling** — press `Y` / `→` for Match and
  `N` / `←` for No match, so you don't have to reach for the mouse between
  every entry.
- **Progress bar** on the Label tab, filling as you work through the queue.
- **Mini bar chart** on the Generate tab's balance grid, so you can see the
  1×1…3×3 distribution at a glance instead of just reading numbers.
- **Small illustrations**: a hand-drawn offer/want icon pair (outward arrow
  for offer, inward arrow for want) used throughout, a checkmark-clipboard
  illustration when the label queue is empty, and a brief check/× animation
  that flashes over the card right after you label it.
- Subtle motion throughout (tab fades, hover states, a one-time draw-in
  animation on the header mark) — nothing looping or distracting, and all
  of it respects "reduce motion" system settings.

## Notes / limits

- The offer/want "drafting" in **Create** is template-based, not an LLM
  call — it's meant as a fast starting point you edit, not a finished
  sentence generator.
  a paid provider (e.g. DeepL) — the caching layer stays the same.
- `labeled_blind` is always recorded as `true`: the labeler only ever sees
  the offer/want text, never a suggested answer.


## Fresh labeling reset

Migration `0010_reset_label_data.sql` clears all existing label history and resets every dataset entry to `unlabeled` while preserving the underlying activities and offer/want pairs. Apply this migration to start labeling from a clean slate.

## Upload 500 fix

Fixed a post-save HTTP 500 in `functions/api/items.js`. The owner quality snapshot INSERT had a placeholder/bind mismatch, so the item could be committed successfully and the API could still throw 500 afterward. The snapshot SQL now has the correct bindings, and quality snapshot writes are best-effort so analytics failures cannot report a successful item save as a failed upload.

### Upload retry protection

Create/draft saves use an idempotency key. If a request succeeds in D1 but the browser loses the response, pressing Save again reuses the same key and the API returns the existing upload rather than inserting duplicate items or creator-pair events. Migration `0011_idempotent_uploads.sql` adds the supporting indexes; the API also self-heals older D1 databases by adding the columns when possible.
