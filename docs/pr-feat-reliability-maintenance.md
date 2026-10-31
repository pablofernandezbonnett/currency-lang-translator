> Historical PR draft. See [README.md](../README.md) for current extension behavior.

## PR Title

`feat(extension): harden runtime lifecycle and clarify licensing`

## PR Type

- [x] Feature
- [x] Bug fix
- [x] Refactor
- [x] Docs
- [ ] Test
- [x] Chore
- [ ] Breaking change

## Summary

Improve the extension's MV3 lifecycle handling, make DOM processing safer on dynamic pages, reduce the requested permission surface, and align the repository documentation and license notice with the actual implementation.

## Problem / Context

The service-worker cleanup alarm reset converted text in every open tab when it cleared its cache. The cache snapshot could also race with the first rate request after worker startup. In the content script, two rapid triggers could queue duplicate conversion runs, and direct text-node changes or editable fields were not handled safely. The README did not describe all supported formats and the `LICENSE` scope was ambiguous for visual assets versus runtime files.

## Changes Made

- Removed the global cleanup alarms and the unused `alarms` permission so rate-cache maintenance never restores page text unexpectedly.
- Rehydrate the persisted rate cache before serving a request, validate snapshot entries, and persist a snapshot after each valid rate fetch.
- Simplified timeout handling and restrict background rate requests to the extension's supported currency set.
- Prevent concurrent conversion runs, observe direct text updates, skip editable elements, and acknowledge popup-to-content messages explicitly.
- Added support for full-width yen (`￥`) and Chinese-yuan formats such as `99 元` and `人民币 99`.
- Corrected the popup preview guard and the wording around Chrome sync storage.
- Updated the README and clarified the split-license notice. Corrected the historical PR example's inaccurate MIT reference.

## Files Changed (and Why)

- `background.js`: make worker cache lifecycle safe, remove alarm-driven page mutations, and validate currency message payloads.
- `content.js`: avoid duplicate processing, support dynamic text updates safely, and expand supported JPY/CNY formats.
- `manifest.json`: remove the unused `alarms` permission.
- `popup.html` / `popup.js`: accurately label sync storage and make the preview-mode message listener safe.
- `README.md`: describe the current cache behavior, privacy boundaries, supported formats, and active-page cache reset behavior.
- `LICENSE`: clarify the scope and precedence of the CC BY-NC-SA and PolyForm Noncommercial licenses.
- `docs/pr-feat-compact-salary-conversion.md`: correct the historical licensing description.

## How to Test

1. Run:
   `node --check content.js`
   `node --check background.js`
   `node --check popup.js`
   `node --check utils.js`
2. Validate the manifest:
   `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"`
3. Reload the unpacked extension in Chrome and verify:
   - the popup saves settings and `Process` works on a static page
   - direct text updates on a dynamic page are processed without duplicate conversions
   - editable fields remain unchanged
   - `￥7.2M`, `99 元`, and `人民币 99` convert correctly
   - clearing the cache only restores original text in the active tab

## Validation Evidence

- `node --check content.js`
- `node --check background.js`
- `node --check popup.js`
- `node --check utils.js`
- `manifest.json: valid JSON`
- Currency-pattern checks passed for `￥7.2M`, `1500 円`, `99 元`, and `人民币 99`.
- `git diff --check`

## Risks / Trade-offs

- Removing alarms means cache expiry relies on timestamp checks and content-script cleanup instead of a periodic cross-tab reset. This is safe because expired rates are never used.
- At the time of this PR, the 200-target cap could leave distant price blocks unprocessed. Later changes replaced it with batching.

## Backward Compatibility

- [x] No breaking changes
- [ ] Breaking changes (described below)

## Deployment / Rollout Notes

- Reload the unpacked extension after merge because the manifest permission set changed.
- The next Chrome prompt should no longer request the `alarms` permission.

## Checklist

- [x] Scope is focused and aligned with the maintenance objective
- [x] Code follows project conventions
- [ ] Tests added or updated where needed
- [x] Documentation and licensing notice updated
- [x] Local verification completed
