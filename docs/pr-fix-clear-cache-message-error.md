> Historical PR draft. See [README.md](../README.md) for current extension behavior.

## PR Title

`fix(extension): restore cache clearing and conversion error reporting`

## PR Type

- [ ] Feature
- [x] Bug fix
- [x] Refactor
- [x] Docs
- [ ] Test
- [x] Chore
- [ ] Breaking change

## Summary

Restore reliable cache clearing and currency conversion by treating notification messages as fire-and-forget, surfacing exchange-rate failures to the user, and using a working exchange-rate endpoint with the narrow permission it requires.

## Problem / Context

Clicking `Clear Cache` produced a message-port error because the content script sent status notifications that did not have a responder, while still expecting a response. Exchange-rate request failures were logged and swallowed, so conversion could silently do nothing. The configured Frankfurter URL redirected to a new endpoint and the fallback provider now requires an API access key, making the documented fallback unreliable.

## Changes Made

- Marked progress, completion, error, and statistics notifications as fire-and-forget; removed the redundant completion message sent after clearing the content-script cache.
- Propagated exchange-rate request failures through the conversion flow so manual processing shows an error instead of silently skipping conversion.
- Switched the rate provider to `https://api.frankfurter.dev/v1`, removed the non-functional fallback, and narrowed `host_permissions` to that provider.
- Simplified service-worker helpers, removed unused update and tab-status listeners, and made the required helper import explicit.
- Replaced custom text-node properties with `WeakMap` state, preserved surrounding whitespace, and excluded additional non-price content (`select`, `code`, `pre`, `kbd`, and `samp`) from DOM processing.
- Updated the README for the current provider and added a short, verified set of official Chrome Extension references.

## Files Changed (and Why)

- `background.js`: centralize reliable rate fetching, cache persistence, cache clearing, and background error handling.
- `content.js`: prevent expected no-response message errors, expose real conversion failures, and make DOM tracking safer.
- `utils.js`: keep only the storage and error helpers used by the service worker.
- `manifest.json`: request access only to the active Frankfurter endpoint.
- `README.md`: describe the actual provider and link to the relevant official Chrome guidance.

## How to Test

1. Run:
   `node --check content.js`
   `node --check background.js`
   `node --check popup.js`
   `node --check utils.js`
2. Validate the manifest:
   `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"`
3. Reload the unpacked extension in Chrome and verify:
   - `Process` converts a supported price on a normal page.
   - `Clear Cache` restores the original text in the active page without a message-port error.
   - A provider failure is shown after a manual process request and leaves the original page text intact.
   - Dynamic page updates do not create duplicate conversions.

## Validation Evidence

- `node --check content.js`
- `node --check background.js`
- `node --check popup.js`
- `node --check utils.js`
- `manifest ok`
- `git diff --check`
- Verified the Frankfurter endpoint returns a valid exchange-rate response.
- Verified every added Chrome documentation link resolves to an official Chrome Developer page.
- Manual Chrome verification confirmed that the extension works again.

## Risks / Trade-offs

- The extension now uses one rate provider instead of an unreliable fallback. A provider outage leaves page text unchanged and reports the failure for manual processing.
- Reloading the unpacked extension is required because the host permission changed from the previous provider domains.
- Full Chrome manual QA remains the source of truth for popup, service-worker, and dynamic-page behavior.

## Backward Compatibility

- [x] No breaking changes
- [ ] Breaking changes (described below)

## Deployment / Rollout Notes

- Reload the unpacked extension from `chrome://extensions` after merge to apply the updated host permission.
- The extension will request access only to `api.frankfurter.dev` for exchange-rate traffic.

## Checklist

- [x] Scope is focused on restoring the broken workflow and improving safe failure behavior
- [x] Code follows project conventions and Manifest V3 constraints
- [ ] Tests added or updated where needed
- [x] Documentation updated
- [x] Local validation completed
- [x] Manual Chrome verification completed
