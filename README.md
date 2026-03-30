# Currency Converter Pro

Chrome Manifest V3 extension that detects prices in page text and shows inline conversions in the user's preferred currency.

The extension no longer performs text translation. Page text is not sent to translation services.

## Features

- Converts detected prices for `USD`, `EUR`, `GBP`, `JPY`, `CNY`, and `KRW`
- Uses bounded caching and fallback exchange-rate providers
- Processes pages automatically or on demand from the popup
- Keeps the original page text intact when parsing or network requests fail
- Tracks conversion counts in `chrome.storage.sync`

## Privacy

- The content script does not call external APIs directly.
- Only exchange-rate requests are sent by `background.js`.
- No page text is sent to external services.
- User preferences and conversion stats are stored in `chrome.storage.sync`.
- Exchange-rate cache snapshots are stored in `chrome.storage.local`.

## Project Structure

- `manifest.json`: extension wiring, permissions, popup, content script, service worker
- `content.js`: DOM scanning, price detection, and inline conversion
- `background.js`: exchange-rate fetches, caching, alarms, and bounded cleanup
- `popup.html` / `popup.js`: settings UI and manual actions
- `utils.js`: small shared helpers for error handling and storage wrappers

## Settings

- Preferred currency
- Message timeout
- Auto-process on page load
- Compact display mode
- Show conversion stats

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select this project directory.

## Usage

1. Open the popup and choose your preferred currency.
2. Visit a page with visible prices.
3. Let the extension process automatically, or click `Process`.
4. Use `Clear Cache` if you want to drop cached rates and reset page markers.

Example:

```text
Original: ¥1,500 for a coffee
Processed: ¥1,500 (≈ €9.27) for a coffee
```

## External APIs

The service worker uses these exchange-rate providers:

1. `https://api.frankfurter.app`
2. `https://api.exchangerate.host`

If one provider fails, the extension falls back safely and leaves the original page text unchanged when no valid rate is available.

## Development

- Plain JavaScript only
- No bundler
- No transpiler
- No build step required

### Minimum validation

Run syntax checks on the runtime files:

```sh
node --check content.js
node --check background.js
node --check popup.js
node --check utils.js
```

If you change `manifest.json`, also validate that it remains valid JSON.

### Manual QA

Reload the unpacked extension in Chrome and verify:

1. The popup opens and saves settings.
2. `Process` works on the active tab.
3. Currency conversion still works on a static page with prices.
4. Currency conversion still works on a dynamic page.
5. No obvious duplicate rewrites or processing loops appear.
6. No errors appear in the page console or service-worker console.

## License

MIT
