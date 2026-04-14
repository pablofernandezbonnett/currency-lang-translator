## PR Title

`feat(extension): fix compact salary parsing and prepare public read-only release`

## PR Type

- [x] Feature
- [x] Bug fix
- [x] Refactor
- [x] Docs
- [ ] Test
- [ ] Chore
- [ ] Breaking change

## Summary

Fix compact salary conversion cases such as `¥7.2M`, reduce unnecessary runtime surface, refresh the popup UI, and prepare the repository to be published publicly as a read-only reference.

## Problem / Context

The extension was converting compact salary values incorrectly because it parsed `¥7.2M` as `7.2 JPY` and left the `M` suffix hanging in the page text. At the same time, the repository and popup still looked like an internal work-in-progress rather than a public reference implementation, and the runtime surface was broader than necessary.

## Changes Made

- Added compact amount parsing for `K`, `M`, and `B` suffixes so salary ranges such as `¥7.2M ~ ¥9.6M` are converted using the real expanded values.
- Reduced extension surface by removing the unused `getSettings` background message and stopping content-script injection into all frames.
- Refreshed the popup UI, replaced the native tooltip with an inline help bubble, exposed stats reset as an explicit action, and aligned the displayed version to `1.0.0`.
- Added public-repo support docs and metadata for a read-only GitHub setup (`LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `README.md` updates).

## Files Changed (and Why)

- `content.js`: fix compact salary parsing and preserve correct inline conversion output.
- `background.js`: remove an unused broad settings message handler.
- `manifest.json`: align the version to `1.0.0` and stop injecting the content script into all frames.
- `popup.html`: improve popup layout, actions, help affordance, and version display.
- `popup.js`: support the popup UI changes, explicit stats reset, preview-safe rendering, and version label syncing.
- `README.md`: document public read-only publication guidance and current runtime behavior.
- `CONTRIBUTING.md`: state the no-contributions policy for the public repo.
- `SECURITY.md`: document the security-reporting stance for a read-only reference repo.
- `LICENSE`: add the MIT license referenced by the README.
- `.gitignore`: ignore `.DS_Store`.

## How to Test

1. Run:
   `node --check content.js`
   `node --check background.js`
   `node --check popup.js`
   `node --check utils.js`
2. Validate the manifest:
   `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"`
3. Load the extension unpacked in Chrome and verify:
   - popup renders correctly and saves settings
   - `Process` works on a page with normal prices
   - `Process` works on a TokyoDev page with compact salaries such as `¥7.2M ~ ¥9.6M`
   - no duplicate rewrites or obvious runtime errors appear

## Validation Evidence

- `node --check content.js`
- `node --check background.js`
- `node --check popup.js`
- `node --check utils.js`
- `manifest ok`
- Verified local popup preview renders without console errors.
- Verified compact salary parsing against real TokyoDev salary strings including:
  - `¥7.2M ~ ¥9.6M annually`
  - `¥8.5M ~ ¥12M annually`

## Risks / Trade-offs

- Removing `all_frames` is safer and narrower, but pages that only expose prices inside embedded frames will now be left unchanged.
- Compact suffix support currently covers `K`, `M`, and `B`; other shorthand styles still degrade by leaving the original text intact.
- Manual Chrome QA is still required before merge because the extension flow cannot be fully validated from local file preview alone.

## Backward Compatibility

- [x] No breaking changes
- [ ] Breaking changes (described below)

## Deployment / Rollout Notes

- If this repository is published publicly, disable pull requests, Issues, and Discussions in GitHub settings.
- Treat forks as the supported path for external modifications.
- Reload the unpacked extension after merge so the popup version and manifest changes are picked up.

## Checklist

- [x] Scope is focused and aligned with the issue
- [x] Code follows project conventions
- [ ] Tests added or updated where needed
- [x] Documentation updated (`README.md`, `AGENTS.md`, etc.)
- [x] Local verification completed
