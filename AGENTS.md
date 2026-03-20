# AGENTS.md

## Project

`currency-lang-translator` is a Chrome Manifest V3 extension that does two things:

- converts detected prices in the DOM into the user's selected currency
- translates visible text only when the user has explicitly consented to sending text to external APIs

When working in this repo, robustness comes before feature creep. If something fails, the correct behavior is to degrade safely and leave the original page intact.

## Real stack

- Plain JavaScript, no TypeScript, no bundler, no transpiler
- Chrome Extension Manifest V3
- `content.js` for reading and mutating page DOM on `http/https` pages
- `background.js` as the service worker for network calls, queues, rate limiting, and alarms
- `popup.html` + `popup.js` for manual configuration
- `utils.js` for small shared helpers
- `chrome.storage.sync` for user settings and stats
- `chrome.storage.local` for service-worker cache snapshots

Do not assume missing tooling. Before proposing Vite, E2E tests, or large refactors, verify that they are actually needed for the requested change.

## Language conventions

- Write `README.md`, `AGENTS.md`, and inline source-code comments in English.
- Keep comments short, technical, and useful; remove stale "refactor" or edit-instruction comments when touching nearby code.
- User-facing examples may include non-English text only when needed to demonstrate translation behavior, but the explanation around them should stay in English.

## Repo map

- [manifest.json](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/manifest.json): permissions, hosts, popup, content script, and service worker
- [content.js](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/content.js): text/currency detection, observers, in-memory cache, and DOM mutation
- [background.js](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/background.js): external API fetches, translation queue, persisted cache, and cross-context messaging
- [popup.html](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/popup.html): popup UI
- [popup.js](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/popup.js): settings read/write, manual actions, and feedback
- [utils.js](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/utils.js): small shared utilities
- [README.md](/Users/pmfb/Documents/coding/chrome-workspace/currency-lang-translator/README.md): product docs, currently more ambitious than the real implementation

## Architecture rules

### 1. Network and privacy

- All external API `fetch` calls must live in `background.js`.
- `content.js` must not talk to the internet directly.
- Never send page text outside the browser unless `consentApi === true`.
- If privacy or consent is unclear, choose the more conservative behavior.

### 2. Cross-context contracts

- All popup, content script, and background communication must go through explicit messages.
- If a `chrome.runtime.onMessage.addListener(...)` handler responds asynchronously, it must `return true`.
- When changing an `action` name or message payload, review every sender and receiver across all 3 contexts.

### 3. DOM robustness

- The DOM of third-party sites is hostile, unstable, and large.
- Every mutation must be idempotent or at least avoid visible duplication.
- Do not process `SCRIPT`, `STYLE`, `NOSCRIPT`, `IFRAME`, or irrelevant nodes.
- Put limits on observers, queues, caches, retries, and batch work.
- On parse, API, or messaging failures, keep the original text.

### 4. Security and CSP

- Respect MV3 and CSP constraints strictly.
- Do not introduce `eval`, inline scripts, unsanitized HTML, or dynamic code execution.
- In popup and content code, prefer `textContent`/`nodeValue` over `innerHTML` unless there is a strong reason and the content is fully controlled.

### 5. State and persistence

- Keep defaults aligned across popup, background, and real runtime behavior.
- Use `storage.sync` only for small user preferences and state.
- Use memory or `storage.local` for technical caches in the worker.
- Do not depend on the service worker staying alive.

## Priorities when changing code

1. Fix correctness and current failures before adding new features.
2. Remove duplication and silent overrides.
3. Reduce coupling between `content.js`, `background.js`, and `popup.js`.
4. Make DOM mutation more predictable.
5. Keep permissions and external traffic to the minimum required.

## Current fragile areas

- `content.js` has duplicated exchange-rate logic. A second `getExchangeRates(...)` definition overrides the first one and calls `getExchangeRate(...)`, which does not exist. Treat this as suspect number one when the extension is "failing".
- Separation of concerns exists, but is blurry: some resilience logic is duplicated across popup, content, and background.
- Translation batching concatenates texts with a simple separator, which can break mapping when rebuilding per-node results.
- `README.md` promises more reliability and coverage than the code currently guarantees. If behavior changes, update the docs as well.

## Recommended work flow

1. Read `manifest.json` and every file you are going to touch.
2. If the change crosses contexts, define the message contract first.
3. Make the smallest patch that fixes the real problem.
4. Review side effects on consent, rate limiting, and DOM duplication.
5. Validate syntax, then run a manual test with the extension loaded in Chrome.

## Minimum validation before closing a task

At minimum, run syntax checks on the touched JavaScript files:

```sh
node --check content.js
node --check background.js
node --check popup.js
node --check utils.js
```

If you touch `manifest.json`, also validate that it is still valid JSON.

## Source of Truth

- `manifest.json` for permissions, script contexts, host access, and extension wiring.
- `background.js`, `content.js`, `popup.js`, and `utils.js` for runtime behavior and cross-context contracts.
- `README.md` and this file for product scope, privacy rules, and manual QA expectations.

## Preferred Skills

- Use `frontend-visual-audit` for popup UX, DOM mutation validation, and browser-facing polish.

## Preferred MCPs

- Use Context7 for Chrome Extension, Web API, and browser runtime API verification.
- Use chrome-devtools for popup/layout/manual validation and page-DOM behavior checks.

## Engineering Heuristics

- DRY: prefer one source of truth for stable logic, contracts, and constants. Extract shared behavior when repetition is real and the same fix would otherwise need to be repeated.
- YAGNI: do not add speculative features, extension points, flags, or abstractions for hypothetical future needs.
- KISS: choose the simplest implementation that is easy to explain, test, and change.
- Simple is not easy: invest in small focused functions and clear structure instead of the fastest large-function shortcut.
- Accept small local duplication temporarily when the right abstraction is not yet clear. Extract only when it improves readability and maintainability.

## NEVER Rules

- NEVER send page text to an external API unless explicit user consent is enabled.
- NEVER call external APIs directly from `content.js`.
- NEVER assume third-party DOM structure is stable enough to justify broad or destructive rewrites.

## Manual QA required for functional changes

Reload the extension in `chrome://extensions` and verify:

1. The popup opens without errors and saves settings.
2. `Reprocess` works on the active tab.
3. With `consentApi` disabled, no remote translation happens.
4. Currency conversion still works on a page with real prices.
5. No errors appear in either the page console or the service-worker console.
6. On dynamic pages, there are no obvious duplicates or reprocessing loops.

Test at least:

- one static page
- one dynamic or infinite-scroll page

## File-specific guidance

### `manifest.json`

- Change permissions or host permissions only when truly required.
- If you add an external host, justify it in code and in the README.
- Keep `matches` and `exclude_matches` as narrow as possible.

### `content.js`

- Its job is to detect, decide, and apply visual changes in the page.
- Do not add direct external API calls here.
- Avoid new full-DOM passes if visibility or mutation signals can be reused.
- Do not introduce new sources of double translation or double conversion.

### `background.js`

- Centralize fetch, cache, queues, retries, and backoff here.
- Any new timeout or retry must be bounded.
- If you change queues or caches, think about per-tab cancellation and worker suspension.

### `popup.js` and `popup.html`

- Keep changes small, clear, and reversible.
- Every UI option must have consistent persistence and clear feedback.
- Do not advertise a capability in the popup unless the code actually supports it.

### `utils.js`

- Keep it small. Only stable shared helpers belong here.
- If a helper starts knowing too much about domain logic, it probably belongs elsewhere.

## Definition of done

A change is ready when it:

- fixes the bug or requested improvement without breaking MV3 flow
- does not expand permissions or external surface area unnecessarily
- does not violate translation consent rules
- passes syntax checks
- passes a reasonable manual test in Chrome

## Incorrect vs Correct

- Incorrect: call external translation or rates APIs directly from `content.js`.
- Correct: keep network access in `background.js` and enforce consent before any external text leaves the browser.

- Incorrect: rename a message `action` or payload shape in one context only.
- Correct: treat popup, background, and content messaging as one explicit cross-context contract and update every sender and receiver together.

- Incorrect: use `innerHTML` or broad DOM rewrites for convenience.
- Correct: prefer narrow, idempotent text-node mutations that leave the original page stable when anything fails.

## What not to do

- Do not invent a build step for small changes.
- Do not add dependencies without a clear reason.
- Do not hide broken contracts behind `try/catch`.
- Do not increase observers, timers, or retries without explicit limits.
- Do not prioritize new features over fixing the current foundation.
