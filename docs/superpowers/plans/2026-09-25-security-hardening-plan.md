# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax. Every code task is test-first: write the failing test, watch it fail,
> implement, watch it pass, commit.

**Goal:** harden the things around the app — which files the ingest pipeline trusts, what the
page is allowed to load and talk to, where the API key lives, and how the app behaves when its
stored data is hostile — without changing a single domain rule.

**Architecture:** five independent work packages over disjoint files, so they can be built in
parallel and reviewed separately. No package changes plan generation, scoring, event shape, or
anything a user would call a feature. Branch `feat/security-hardening`; nothing is pushed.

**Tech stack:** vanilla Vite + React, Vitest, Playwright walks in `scripts/e2e/`, Node scripts
for the Mac-side ingest pipeline.

**Source:** a private review of the Attempt 2 release (kept in James's vault, not in this repo,
because it describes weaknesses of a public app). This plan states *what* is hardened, never how
the weakness could be used.

---

## Rules that bound every task

- `pouch-down-v1` is read, never written, never deleted. It is the rollback.
- Events are append-only. Silence is never success. Nothing James-specific is hardcoded.
- No personal usage data in this repo. Fixtures are synthetic. Never commit a key.
- No exploit detail in commit messages, code comments, or `docs/`. Say what was hardened.
- Never push. `main` auto-deploys to a phone that a real quit attempt depends on.

---

## Task B1 — The ingest pipeline trusts sources, not filenames

**Files:**
- Modify: `scripts/ingest-backup.mjs`
- Modify: `src/ingest.js` (free-text escaping in the Live Log renderer)
- Test: `src/__tests__/ingest.test.js`, new `src/__tests__/ingestTrust.test.js`

The watcher picks files out of `~/Downloads` and the iCloud `PouchDown` folder. A filename is not
provenance, so `~/Downloads` gets a provenance check instead: macOS records where a downloaded
file came from in its `com.apple.quarantine` extended attribute, and an AirDropped file names
`sharingd` as the agent. James's phone backups arrive by AirDrop only (confirmed 2026-09-25), so
that is the rule for that folder. The iCloud folder is trusted by location, as before.

- [ ] **Step 1: failing test for the provenance gate.** In `ingestTrust.test.js`, drive `ingest()`
      against a temp dir standing in for `~/Downloads` with an injected `provenance` function
      (default implementation reads the real xattr; tests inject). A file whose provenance is not
      AirDrop must appear in `result.rejected` with reason `untrusted-source`, must NOT be copied
      into `Backups/`, must NOT be moved, and must not change `Live Log.md`.
- [ ] **Step 2: run it, watch it fail.** `npx vitest run src/__tests__/ingestTrust.test.js`
- [ ] **Step 3: implement.** Add to `scripts/ingest-backup.mjs`:
      a `provenance(file)` helper that runs `xattr -p com.apple.quarantine <file>` via
      `spawnSync` and returns the agent field (the third `;`-separated field), `null` when the
      attribute is absent or the command fails; a `trusted({ dir, file, provenance })` predicate
      — `true` for iCloud dirs, otherwise `provenance(file) === 'sharingd'`; both injectable
      through `ingest(opts)` so tests never touch real xattrs. Untrusted candidates are skipped
      with a `rejected` entry and a one-line log that names the file and the reason only.
- [ ] **Step 4: run it, watch it pass.**
- [ ] **Step 5: size cap, test-first.** A candidate whose `stat.size` exceeds 5 MB is rejected
      (`too-large`) before any read.
- [ ] **Step 6: export-time clamp, test-first.** A backup whose `exportedAt` is more than five
      minutes ahead of `now` is rejected (`future-export`). `newestArchived()` and the
      newest-of-parsed comparison both ignore future-dated files, so a stale note can never be
      pinned by one.
- [ ] **Step 7: validate before filing, test-first.** Run the parsed root through the same
      well-formed check the app uses before copying it into `Backups/`. A parseable-but-unreadable
      file is rejected (`unreadable-root`) and left where it is — today it is archived first and
      then re-selected on every run, which freezes the note until it is deleted by hand.
      Export `wellFormed` from `src/root.js` (it exists, unexported) and import it here.
- [ ] **Step 8: escape free text, test-first.** In `src/ingest.js`, every value that came from a
      backup (attempt id, status, stage names, trigger labels) passes through one `safeText()`
      helper before it is written into `Live Log.md`: backticks, `~~~`/```` ``` ```` fences, `<%`,
      `%>`, and `<`/`>` are neutralised, newlines collapsed, length capped. Headings are built
      from fixed strings plus `safeText()`, never from a raw id.
- [ ] **Step 9: the hostile-file walk.** One synthetic fixture in `ingestTrust.test.js` carrying
      every nasty property at once (no AirDrop provenance, future export time, unreadable root,
      free text full of fences and template tags) must be rejected, leave `Backups/` unchanged,
      leave the original in place, and leave `Live Log.md` byte-identical.
- [ ] **Step 10: full suite + commit.** `npm test && npm run lint`
      `git commit -m "harden ingest: trust the source folder and AirDrop provenance, cap size, clamp export time, validate before filing, escape free text"`

---

## Task B2 — Content Security Policy, and Inter served from our own files

**Files:**
- Modify: `vite.config.js` (build-only HTML transform; drop the Google-fonts runtime cache)
- Modify: `src/index.css` (remove the remote `@import`, add `@font-face`)
- Create: `src/fonts/inter-*.woff2`, `src/fonts/OFL.txt`
- Test: new `src/__tests__/csp.test.js`

- [ ] **Step 1: failing test.** `csp.test.js` reads `vite.config.js`'s exported plugin list,
      finds the CSP plugin, runs its `transformIndexHtml` on a minimal HTML string, and asserts
      the output carries a `<meta http-equiv="Content-Security-Policy">` whose content includes
      `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-src 'none'`,
      `connect-src 'self' https://api.anthropic.com`, and `worker-src 'self' blob:`; and that no
      `fonts.googleapis.com` or `fonts.gstatic.com` appears anywhere in the policy.
- [ ] **Step 2: run it, watch it fail.**
- [ ] **Step 3: implement the plugin.** In `vite.config.js`, a small plugin
      `{ name: 'csp', apply: 'build', transformIndexHtml(html) { … } }` that injects the meta tag
      into `<head>`. `apply: 'build'` matters: dev-mode hot reload needs `'unsafe-inline'` and
      a websocket, so the policy must never be present in dev.
- [ ] **Step 4: self-host Inter.** Fetch the two Latin `woff2` files Google serves for Inter
      (variable, `latin` and `latin-ext` subsets) with `curl` into `src/fonts/`, add the SIL Open
      Font License text next to them, replace the `@import` in `src/index.css` with `@font-face`
      rules using `font-display: swap` and the same weights the app uses, and delete the
      `runtimeCaching` entry for Google fonts from the PWA config — the fonts are precached by
      `globPatterns` once they are local. Add no npm dependency.
- [ ] **Step 5: prove it in a build.** `npm run build`, then assert in the test that
      `dist/index.html` contains the policy and that no built file references `fonts.gstatic.com`
      or `fonts.googleapis.com`.
- [ ] **Step 6: prove it in a browser.** `npm run e2e` — all five walks must pass with zero
      console errors. A CSP violation shows up as a console error, so this is the real gate.
- [ ] **Step 7: commit.**
      `git commit -m "add a Content Security Policy at build time and serve Inter from our own files"`

---

## Task B3 — The key stops living on the device

**Files:**
- Create: `src/sessionKey.js`
- Modify: `src/components/SettingsSheet.jsx`, `src/components/CoachSheet.jsx`,
  `src/components/onboarding/PriceHelpSheet.jsx`, `src/root.js` (blank an inherited key on load)
- Test: new `src/__tests__/sessionKey.test.js`, and an addition to `src/__tests__/root.test.js`
- **Do not touch** `src/store.js` (Task B5 owns it).

The key is the one secret the app holds. It does not need to be at rest: the coach is used
occasionally, and iOS password managers can fill a password field on demand. So the key lives in
memory for the session, and `sessionStorage` carries it across a reload (per-tab, so a sibling
page cannot read it). Nothing writes it to `localStorage` ever again.

- [ ] **Step 1: failing test.** `sessionKey.test.js`: `setKey('sk-ant-test')` then `getKey()`
      returns it; `subscribe()` fires on change; a fake `localStorage` passed to the module is
      never written; `clearKey()` empties both memory and `sessionStorage`; a `sessionStorage`
      that throws (private mode, blocked storage) degrades to memory-only without throwing.
- [ ] **Step 2: run it, watch it fail.**
- [ ] **Step 3: implement `src/sessionKey.js`.** Module-level variable plus a guarded
      `sessionStorage` read/write in try/catch, `getKey()`, `setKey()`, `clearKey()`,
      `subscribe(fn)`. No React import; the sheets subscribe with `useEffect`.
- [ ] **Step 4: failing test for the inherited key.** In `root.test.js`: a stored v2 whose
      `device.apiKey` is non-empty must, after `loadRoot` + the app's first save, be stored with
      `device.apiKey` empty, and the key must be available from `sessionKey` for that session.
      `pouch-down-v1` must be byte-identical before and after — assert it.
- [ ] **Step 5: implement.** In `src/root.js`, `settle()` moves a non-empty `device.apiKey` into
      `sessionKey.setKey()` and returns the root with `device.apiKey: ''`. `loadRoot` still never
      writes; the blanked value is persisted by the app's next ordinary save.
- [ ] **Step 6: wire the UI.** `SettingsSheet.jsx`: the field becomes
      `type="password"`, `autoComplete="current-password"`, `name="anthropic-api-key"`,
      `spellCheck={false}`, `autoCapitalize="none"`, reading and writing `sessionKey` instead of
      `device.apiKey`, with helper text in the app's voice saying the key is kept for this
      session only and suggesting a password manager. `CoachSheet.jsx` and `PriceHelpSheet.jsx`
      read `getKey()` instead of `device.apiKey`; their "no key yet" states already exist and
      must still work.
- [ ] **Step 7: prove the key is nowhere at rest.** A test that sets a key, runs a save, and
      asserts no value under any `localStorage` key contains it.
- [ ] **Step 8: full suite, then `npm run e2e`, then commit.**
      `git commit -m "hold the API key for the session only, never on the device"`

---

## Task B4 — Hostile stored data can never brick the app

**Files:**
- Modify: `src/root.js` (deeper checks, dump through the redactor),
  `src/components/ErrorBoundary.jsx`
- Test: `src/__tests__/root.test.js`, new `src/__tests__/crashLoop.test.js`

- [ ] **Step 1: failing test.** A root that passes today's shape check but cannot render —
      `settings.mealTimes` null, a stage with no `slots`, an event whose `trigger` is an object —
      must come back from `loadRoot` as `{ problem: 'corrupt' }`, with the stored bytes untouched.
- [ ] **Step 2: run it, watch it fail.**
- [ ] **Step 3: deepen `wellFormed`.** Check the fields every screen leans on: `settings` object
      shape including `mealTimes`, every stage carrying a `slots` array, every event having a
      string `type` and a string-or-null `trigger`, `ts`/`day` strings where the readers expect
      them. Keep it a pure predicate; keep it exported for Task B1.
- [ ] **Step 4: recovery after a second failed launch, test-first.** `ErrorBoundary` records a
      boot-crash marker in `sessionStorage` (guarded), and on a second consecutive crash offers
      the recovery screen — Download backup, Start fresh — instead of the same crash screen the
      reload lands back on. A successful render clears the marker.
- [ ] **Step 5: the raw dump goes through the redactor, test-first.** `rawStorageDump` passes the
      serialised output through `redactSecrets` as a final pass, so a key-shaped string anywhere
      in it is masked regardless of which field held it.
- [ ] **Step 6: full suite + commit.**
      `git commit -m "survive hostile stored data: deeper root checks, recovery after a repeat boot crash, redact the whole dump"`

---

## Task B5 — Remove the check-in deep link, and repo housekeeping

**Files:**
- Modify: `src/App.jsx` (delete the `?checkin=` parsing), `src/store.js` if it holds
  deep-link-only helpers
- Create: `.github/dependabot.yml`
- Modify: `.github/workflows/deploy.yml` (pin actions to exact verified commits)
- Modify: `src/__tests__/backup.test.js`, `ingest.test.js`, `migrate.test.js`, `root.test.js`,
  `docs/superpowers/plans/2026-09-18-attempt-2-build-plan.md` (invented timestamps)
- Test: `src/__tests__/app.test.js` or the nearest existing App test

James does not use the Shortcut and does not want it, so the untrusted URL input goes away
entirely rather than being hardened. Manual check-ins in the app are untouched — this task must
not change the check-in feature, only the URL entry point.

- [ ] **Step 1: failing test.** Loading the app with `?checkin=…` in the URL must create no
      event and must leave the URL cleaned; the manual check-in path must still write a
      `checkin` event exactly as before.
- [ ] **Step 2: run it, watch it fail** (today the deep link creates an event).
- [ ] **Step 3: delete the deep-link branch** in `src/App.jsx`, including its URL-stripping and
      the `source: 'shortcut'` path it fed. Leave `source: 'manual'` and everything downstream
      alone; leave stored `shortcut` check-ins readable — history is append-only.
- [ ] **Step 4: run the suite.** Any test asserting deep-link behaviour is updated to assert it
      is ignored, never deleted quietly.
- [ ] **Step 5: `.github/dependabot.yml`**, weekly, two ecosystems (`github-actions` at `/`,
      `npm` at `/`), open-PR limit 5.
- [ ] **Step 6: pin the five actions** in `deploy.yml` to the exact commits verified in the
      review, each with a trailing `# vX.Y.Z` comment. Keep the `chore/actions-node24` branch's
      major versions — pinning must not change which version runs.
- [ ] **Step 7: replace the eight real timestamp literals** in the four test files and the one
      plan document with invented values, keeping every relative interval the tests depend on.
      Run the suite: same passes, same counts. History is not rewritten — James's decision.
- [ ] **Step 8: commit** in two commits, one for the deep link, one for housekeeping.

---

## Task B6 — Paperwork

**Files:** `CLAUDE.md`, `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md`, and in the
vault: the review note's `status` fields, two Claude Brain notes.

- [ ] Add to `CLAUDE.md` only the rules that outlive this session: the ingest pipeline trusts
      sources (folder plus AirDrop provenance), not filenames; the API key is held for the
      session only and is never written to device storage; the CSP is injected at build only.
- [ ] Append a dated section to the build log: what was hardened, what James did himself, test
      and E2E results. No exploit detail, no personal numbers.
- [ ] In the vault: tick the review note's items, write a Claude Brain note on phone-vs-terminal
      permissions (the lesson James asked for), and one recording this session's decisions.
      Commit only the touched vault files with a `claude:` message.

---

## Exit gate

- [ ] `npm test` — all pass, no new skips
- [ ] `npm run lint` — no more than the 2 baseline warnings
- [ ] `npm run build` — clean
- [ ] `node docs/superpowers/reports/2026-07-10-math-harness.mjs` — passes
- [ ] `npm run e2e` — 5/5 walks, 0 console errors (this is where a CSP mistake surfaces)
- [ ] `git diff --stat main...feat/security-hardening` in the summary
- [ ] Nothing pushed. Ask James before any merge.
