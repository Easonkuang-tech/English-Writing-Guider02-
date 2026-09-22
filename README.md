# Bandcraft

Multiuser-ready IELTS writing practice for turning daily vocabulary and
sentence patterns into searchable writing practice. V1 runs locally and keeps
browser data as an offline cache; the deployment target is Railway plus
Supabase.

## Deployment Target

```text
Railway: web service, static assets, server-side DeepSeek proxy
Supabase: Auth, PostgreSQL, Row Level Security, cloud synchronization
```

The browser remains usable offline. Supabase becomes the final cloud source of
truth after authentication and synchronization are enabled.

Required Railway variables:

```text
PORT
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
APP_ORIGIN
```

Run migrations in `supabase/migrations/` in filename order.

## Run

Two ways to run:

### A. Static deployment

The compiled `public/` folder can run as a standalone static bundle:

```powershell
# Bundle the prompts (run once after pulling new IELTS prompts)
node scripts/bundle-prompts.cjs

# Deploy the public/ directory to any static host (CloudStudio, GitHub
# Pages, Netlify, etc.). Open the resulting URL in a browser.
```

After opening the site, fill the DeepSeek API key in **设置 → AI 服务 →
DeepSeek**. The key is stored only in this browser's `localStorage` and sent
directly from the browser to `api.deepseek.com` (or another DeepSeek-
compatible endpoint). All other data — prompts, drafts, attempts, corpus
items, learning extensions — also lives in `localStorage`.

### One-click activation (no key in the bundle)

Because `public/` ships as a public static bundle, the API key is deliberately
**never baked into the JavaScript**. To configure another browser or device
without typing the key by hand, use an activation link:

```
https://<host>/#bc_key=sk-...&bc_model=deepseek-chat&bc_base=https://api.deepseek.com
```

Supported parameters: `bc_key` (required), `bc_model`, `bc_base`. The query
form (`?bc_key=...`) works too, but the fragment form is preferred because a
fragment is never sent to the server.

On load the key is moved into `localStorage` and the parameters are scrubbed
from the address bar via `history.replaceState`, so the key does not linger in
the URL. A toast confirms the activation.

Generate a link for the current device with **设置 → AI 服务 → 复制激活链接**.
Treat that link as a secret: anyone who opens it gets your key.

### B. Local Node.js server

```powershell
Copy-Item .env.example .env.local   # optional, see note below
node server.mjs
```

Open `http://localhost:4173`.

`server.mjs` supports both browser-side DeepSeek activation and a server-side
fallback. For Railway deployment, use the server-side proxy and keep the
DeepSeek Key in Railway variables.

## Features

- Separate Task 1 and Task 2 prompt banks.
- Markdown prompt import and export.
- Daily vocabulary, collocation, and sentence-pattern input.
- One-prompt daily recommendation with a local fallback.
- Simple Practice using the 10-point daily rubric.
- Full Essay using four estimated IELTS criteria.
- Daily Mini Practice teaching flow with task coverage, core ideas, sentence
  notes, three teacher corrections, minimal rewrite, and repeated revision
  rounds until the basic version is correct.
- Optional learning extension that generates a complete improved version only
  after the user clicks, then weighted-randomly teaches one of introduction,
  both views, reason development, or position.
- Pattern extraction checks and a 50-80 word transfer exercise.
- Target-language usage checks and corrections.
- Personal corpus training with a strict New -> Controlled -> Reused ->
  Spontaneous progression.
- Chinese intent, first attempt, one IELTS standard expression, confirmed
  abstract framework, new-context tests, and real-use evidence.
- Naturalness is scored from 0-10 with a fixed level label.
- Corpus items support a user-defined name, including an automatic naming step
  after reaching Spontaneous.
- Framework reveal tracking: a Reused attempt cannot upgrade when the learner
  opens the framework.
- Reused tests use a system-generated, pure-Chinese sentence that naturally
  fits the confirmed framework; learners can request another sentence.
- Review dates and complete corpus history in backup files.
- Retrieval schedule with a 7-minute first attempt, 5-minute card building,
  two same-day check-ins, and timed day 2/3/7/15/30/60 reviews.
- The first 7-minute attempt starts only after a manual check-in button.
- Every self-test and scheduled review returns original-to-correction pairs,
  reasons, naturalness score, and a complete natural version.
- Ability level and test-type preferences adapt later retrieval difficulty.
- Autosaved drafts, timer, history search, and full reports.
- Versioned JSON backup and Markdown practice export.

## Test

```powershell
node --test
```

With the local server running, verify the mobile and desktop interface flow:

```powershell
node tests/browser-check.mjs
```

The browser check writes `browser-mobile.png` and `browser-desktop.png` for
visual inspection. To include a real DeepSeek submission and report flow:

```powershell
$env:RUN_AI = "1"
node tests/browser-check.mjs
```

The AI browser check also writes `browser-report-mobile.png`.

## Local Data

- Prompts, daily materials, drafts, attempts, and reports are stored in browser
  `localStorage`.
- Settings can export and restore a versioned JSON backup.
- Practice history can also be exported as Markdown.
- DeepSeek credentials live in `localStorage` under `bandcraft:deepseek-config:v1`
  and are never uploaded — they are sent only as a `Bearer` token to the
  configured DeepSeek endpoint, directly from this browser.
