## PR Title

`fix(extension): improve conversion accuracy and page handling`

## PR Type

- [x] Bug fix
- [x] Refactor
- [x] Docs

## Summary

Fix incorrect price matches, prevent duplicate conversions, and make page updates and popup feedback more reliable.

## Changes Made

- Reject ambiguous number formats and convert explicit CNY amounts only once.
- Preserve page edits when restoring text. Scan matching nodes in batches and revisit changed regions.
- Serialize statistics updates in the service worker. Report setting and processing failures in the popup.
- Prevent in-flight rate requests from restoring a cleared cache.
- Update the README and AGENTS.md to match the current behavior.

## How to Test

- Run `node --check` on all four JavaScript files and `git diff --check`.
- Check `CN¥7.2M`, `€1.234,56`, and `$1,23` on a static page.
- Check new prices and edited text on a dynamic page, then use `Process` and `Clear Cache`.
- Verify popup settings, statistics reset, and page and worker consoles in Chrome.

## Validation Evidence

Syntax and diff checks passed. Local behavior checks covered 240 prices, dynamic updates, text restoration, popup errors, statistics ordering, and cache clearing races. Manual Chrome testing passed.

## Risks / Trade-offs

Ambiguous formats remain unchanged.
