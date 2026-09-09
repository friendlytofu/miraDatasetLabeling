# Mira Dataset Studio

A small internal tool for expanding the Mira offer/want matching training set:
draft offer/want phrasings from plain-language activity descriptions, generate
balanced non-repeating 1–3-offer × 1–3-want combinations, label them yes/no
(with Chinese translation and shared-wording highlights to speed labeling up),
and export in the exact training-data JSON format.

Static frontend (`index.html`, `style.css`, `app.js`) + Cloudflare Pages
Functions (`/functions/api/*`) + a Cloudflare D1 database for storage.

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
- **Label** — shows one queued combination at a time. Chinese translations
  (via the free MyMemory API, cached in D1 so repeats are instant) and
  shared-word highlighting across the offer/want texts are both there to
  speed up reading. "Match" / "No match" writes `human_label`, the current
  labeler name (persisted in the browser), `labeled_blind: true`, and a
  real timestamp captured at click time in the labeler's own local time
  zone.
- **Export** — downloads every labeled entry as a JSON array in the target
  format, with `id` renumbered sequentially from 0.

## Notes / limits

- The offer/want "drafting" in **Create** is template-based, not an LLM
  call — it's meant as a fast starting point you edit, not a finished
  sentence generator.
- Translation uses MyMemory's free, keyless endpoint, which is rate-limited
  (~5,000 words/day anonymously). For heavier use, swap `translate.js` for
  a paid provider (e.g. DeepL) — the caching layer stays the same.
- `labeled_blind` is always recorded as `true`: the labeler only ever sees
  the offer/want text, never a suggested answer.
