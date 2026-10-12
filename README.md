# PantryPing

[Open PantryPing](https://aaravsinhaofficial.github.io/pantryping/)

A small, buildless food-pantry availability board on GitHub Pages. Check food categories, make a visit checklist, and see hours and requirements without a visitor account.

**The included pantry and stock statuses are fictional demo data. Do not use them to plan a visit.**

## For visitors

- Search food categories or show only available/limited stock.
- Add the categories you need to **My visit list**. See which are reported in stock; copy or print a plan with hours and requirements.
- The list stays only in the current tab. It does not reserve food.
- After 24 hours, or with a missing/unreliable timestamp, the board shows **Not confirmed** and excludes old positive reports from the stock filter.
- For a verified real pantry, public phone and directions links are enabled. Demo data never produces directions or a call link.

## For pantry staff

Open **Pantry staff** and choose one of three ways to start:

1. **Upload a sheet:** drag a CSV or PantryPing JSON file onto the upload area, or browse for it. A downloadable CSV template includes your categories. CSV stays on your device; JSON may also replace pantry details. Files are limited to 100 KB.
2. **AI stock note:** write a short public inventory note. Enable AI, sign in with Puter, then generate suggestions. Each non-unknown suggestion includes a quote from your note for review.
3. **Edit manually:** choose statuses directly from the dropdowns.

Review every category and all changed details. Imports and AI set unmentioned categories to **Not confirmed**. Old or undated real JSON reports also become unconfirmed. Check the review box, then preview locally or publish.

### Easier publishing

Choose **Publish with GitHub**, then **Continue to GitHub**. GitHub opens a prepared publication request. Leave the title and JSON unchanged and click **Create** within 15 minutes of your review. The issue, its data, and the repository are public.

Only **aaravsinhaofficial**, the repository owner, can publish through this workflow. Other visitors can try the editor but cannot change the board. GitHub handles authentication; no GitHub token or password goes into PantryPing.

The Action validates the request, checks the inventory confirmation time, and compares the pantry file SHA before saving only `pantry.json`. The editor also rejects a board changed since you loaded it. A newer change is never force-overwritten. Successful requests are closed with a result comment and the same workflow deploys Pages. Check **Actions** for completion, then use **Refresh board** on the site. This normally takes a few minutes. A rejected request describes how to recover; prepare a new request after fixing it.

**Backup & manual publishing** still offers a JSON download and the repository upload page. Previews and downloads do not publish. Drafts are held in memory and lost on reload.

### CSV format

Use the exact headers `category,status` (either order, case-insensitive). Each category must match an existing ID or full name. One row per category; missing categories become unknown. Quoted commas, escaped quotes and multiline CSV fields are supported; malformed or duplicate rows are rejected.

```csv
category,status
produce,available
grains,available
dairy,limited
baby,unavailable
```

Statuses: `available`, `limited`, `unavailable`, `unknown`. Friendly aliases: `In stock`, `Out of stock`, `Not confirmed`. The template starts every category at **Not confirmed**. It never carries old stock forward automatically.

## AI behavior, cost and privacy

This is a real optional generative-AI integration through [Puter.js](https://docs.puter.com/AI/chat/), using Puter's default chat model. It is not a simulated response or a keyword matcher.

- The provider SDK loads only after **Enable AI**. Staff explicitly sign in and click **Generate suggestions** for each request. Generation uses the signed-in user's Puter credits, subject to Puter's terms and limits; no unlimited-free claim is made. See [Puter's usage model](https://docs.puter.com/user-pays-model/).
- Puter receives your stock note and public category IDs/names/descriptions. Existing stock, pantry contact information, hours and eligibility policies are excluded from the AI prompt. Do not include names, student information, household details, private contact information or other sensitive data in a note.
- Suggestions must use known category IDs and allowed statuses. Non-unknown statuses require a verbatim supporting quote. Missing categories become unknown. This verifies the output format and quotations, not the correctness of an interpretation: **a person must review every suggestion**.
- AI cannot directly publish or change pantry policies. Invalid responses and service/credit failures show errors; there is no fake fallback or automatic billable retry. Upload and manual editing remain available without AI.

Visitors use no account, geolocation, analytics, cookies or local storage added by this app. GitHub handles hosting requests. The optional Puter SDK has its own account/storage/privacy behavior once enabled. Phone/maps links open only on request. Published pantry data and publish-request issues are public.

## Before using a real pantry

Get a pantry partner's agreement. Replace and verify **all** sample address, phone, hours, service area, requirements, stock and notes, then turn off the demo checkbox. Never publish client/visitor records. This version supports one pantry and category-level stock, not individual product quantities, reservations, nearest-pantry search or automatic inventory synchronization.

## Deployment and development

The repository uses **Settings → Pages → Source → GitHub Actions**. `.github/workflows/pages.yml` tests and deploys on `main` changes, manual workflow dispatch, or a successful owner publication request. Issues and Actions must be enabled. The issue-processing job alone has contents/issues write permissions; the deploy job has read access plus Pages deployment permissions. There is no custom server, database, dependency installation or build step.

To reuse this repository, update `REPOSITORY` in `publish.mjs`, the repository links in `index.html`/README, and choose GitHub Actions as the new repository's Pages source. All asset URLs are relative.

```sh
python3 -m http.server 8000
# Open http://localhost:8000
node --test
node --check app.mjs
```

ES modules require HTTP(S); `file:` URLs are unsupported. Failed data loads show no inventory claims. Public unauthenticated GitHub API requests used to prepare a publish link may be rate-limited; a backup download remains available.

## Project structure

- `index.html`, `styles.css`, `favicon.svg`: responsive interface and original vector illustration.
- `app.mjs`: visitor checklist, staff review, upload, AI and publishing UI.
- `data.mjs`: strict pantry schema, freshness and filters.
- `import.mjs`: local CSV parser and safe template.
- `ai.mjs`: opt-in Puter integration and suggestion validation.
- `publish.mjs`: Git blob hashing and prepared GitHub request.
- `scripts/publish-request.mjs`: owner authorization and conflict-safe update processing.
- `*.test.mjs`: data, import, AI response and publication tests. AI tests mock responses; they do not spend account credits or establish live model accuracy.
- `pantry.json`: public data, currently fictional.

## AI assistance and competition status

The implementation, visual design, demo data, documentation and tests were created with substantial assistance from OpenAI's ChatGPT/Codex. Runtime stock suggestions additionally use Puter AI when enabled. **Nothing has been submitted to a competition.** Do not describe the implementation as entirely student-written. Any future submission must accurately disclose AI assistance and the student's own contributions and meet that competition's rules.
