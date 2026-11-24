## PR Title

`fix(extension): avoid partial prices and simplify rate handling`

## PR Type

- [x] Bug fix
- [x] Refactor
- [x] Docs

## Summary

Avoid partial conversions of ambiguous amounts and simplify page processing.

## Changes Made

- Reject partial matches before trailing `元` and `円` currency markers.
- Use the service worker as the only exchange-rate cache.
- Remove layout measurements and sorting during text-node scans.
- Update the README and AGENTS.md to match the behavior.

## How to Test

- Run syntax checks on all four JavaScript files and `git diff --check`.
- Confirm `1.234,56 元` and `1,23 円` stay unchanged; confirm `99 元` and `¥100` convert.
- Check `Process` and `Clear Cache` on static and dynamic pages in Chrome.

## Validation Evidence

Syntax and diff checks passed. Eleven parser cases passed locally. Manual Chrome QA remains to be done.

## Risks / Trade-offs

New price scans send a message to the service worker, which serves cached rates without another API request.
