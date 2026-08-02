importScripts("utils.js");

class RateLimiter {
  constructor(maxRequests = 10, windowMs = 60000) {
    this.requests = [];
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter((time) => now - time < this.windowMs);
    return this.requests.length < this.maxRequests;
  }

  makeRequest() {
    if (!this.canMakeRequest()) {
      return false;
    }

    this.requests.push(Date.now());
    return true;
  }
}

const DEFAULT_SETTINGS = {
  currency: "EUR",
  msgTimeout: 3,
  autoProcess: true,
  showStats: false,
  compactMode: false,
  stats: { conversions: 0 },
};

const CACHE_DURATION = 10 * 60 * 1000;
const API_BACKOFF_DURATION = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const RATE_CACHE_STORAGE_KEY = "rateCacheSnapshot";

const apiRateLimiter = new RateLimiter(15, 60000);
const rateCache = new Map();
const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "JPY", "CNY", "KRW"]);

const CURRENCY_APIS = [
  {
    name: "frankfurter",
    url: (base, target) =>
      `https://api.frankfurter.dev/v1/latest?from=${base.toUpperCase()}&to=${target.toUpperCase()}`,
    parseResponse: (data, target) =>
      data && data.rates ? data.rates[target.toUpperCase()] : null,
    disabledUntil: 0,
  },
];

async function initializeDefaultSettings() {
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const missingEntries = Object.entries(DEFAULT_SETTINGS).filter(
    ([key]) => typeof stored[key] === "undefined"
  );

  if (missingEntries.length === 0) {
    return;
  }

  const missingSettings = Object.fromEntries(missingEntries);
  await chrome.storage.sync.set(missingSettings);
}

async function persistRateCache() {
  try {
    const snapshot = [];
    for (const [key, value] of rateCache.entries()) {
      snapshot.push({ key, value });
    }

    await saveToStorage({ [RATE_CACHE_STORAGE_KEY]: snapshot });
  } catch (error) {
    console.warn("Failed to persist rate cache:", getErrorMessage(error));
  }
}

async function rehydrateRateCache() {
  try {
    const stored = await loadFromStorage([RATE_CACHE_STORAGE_KEY]);
    const snapshot = stored && stored[RATE_CACHE_STORAGE_KEY];

    if (!Array.isArray(snapshot)) {
      return;
    }

    const now = Date.now();
    for (const item of snapshot) {
      if (
        item &&
        item.key &&
        item.value &&
        Number.isFinite(item.value.rate) &&
        Number.isFinite(item.value.timestamp) &&
        item.value.timestamp <= now &&
        now - item.value.timestamp < CACHE_DURATION
      ) {
        rateCache.set(item.key, item.value);
      }
    }
  } catch (error) {
    console.warn("Failed to rehydrate rate cache:", getErrorMessage(error));
  }
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchRateForCurrency(fromCurrency, toCurrency) {
  await rateCacheReady;

  const cacheKey = `${fromCurrency}_${toCurrency}`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return { rate: cached.rate };
  }

  const errors = [];

  for (const api of CURRENCY_APIS) {
    if (Date.now() < api.disabledUntil) {
      errors.push(`${api.name} is temporarily disabled.`);
      continue;
    }

    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!apiRateLimiter.makeRequest()) {
          throw new Error("Global rate limit exceeded");
        }

        const url = api.url(fromCurrency, toCurrency);
        const data = await fetchJsonWithTimeout(url);
        const rate = api.parseResponse(data, toCurrency);

        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error("Invalid rate data received");
        }

        api.disabledUntil = 0;
        rateCache.set(cacheKey, { rate, timestamp: Date.now() });
        await persistRateCache();
        return { rate };
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    api.disabledUntil = Date.now() + API_BACKOFF_DURATION;
    errors.push(
      `${api.name} failed after 1 retry and is disabled for 5 minutes. Error: ${getErrorMessage(
        lastError
      )}`
    );
  }

  return { error: errors.join(", ") || "The exchange-rate provider failed." };
}

async function clearBackgroundCaches() {
  await rateCacheReady;
  rateCache.clear();

  for (const api of CURRENCY_APIS) {
    api.disabledUntil = 0;
  }

  await chrome.storage.local.remove(RATE_CACHE_STORAGE_KEY);
}

const rateCacheReady = rehydrateRateCache();

chrome.runtime.onInstalled.addListener(() => {
  initializeDefaultSettings().catch((error) => {
    console.warn("Failed to initialize default settings:", getErrorMessage(error));
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getRates") {
    const payload = request.payload || {};
    const fromCurrencies = Array.isArray(payload.fromCurrencies)
      ? [
          ...new Set(
            payload.fromCurrencies
              .map((value) => String(value).toUpperCase())
              .filter((currency) => SUPPORTED_CURRENCIES.has(currency))
          ),
        ]
      : [];
    const toCurrency = payload.toCurrency ? String(payload.toCurrency).toUpperCase() : "";

    (async () => {
      if (!SUPPORTED_CURRENCIES.has(toCurrency) || fromCurrencies.length === 0) {
        sendResponse({ rates: {} });
        return;
      }

      const rates = {};
      const errors = [];

      for (const fromCurrency of fromCurrencies) {
        if (fromCurrency === toCurrency) {
          rates[fromCurrency] = 1;
          continue;
        }

        const result = await fetchRateForCurrency(fromCurrency, toCurrency);
        if (typeof result.rate === "number") {
          rates[fromCurrency] = result.rate;
        } else if (result.error) {
          errors.push(`${fromCurrency}->${toCurrency}: ${result.error}`);
        }
      }

      if (Object.keys(rates).length > 0) {
        sendResponse({
          rates,
          warning: errors.length > 0 ? errors.join(" | ") : undefined,
        });
        return;
      }

      sendResponse({
        error: errors.join(" | ") || "Unable to fetch exchange rates.",
      });
    })().catch((error) => {
      sendResponse({ error: getErrorMessage(error) });
    });

    return true;
  }

  if (request.action === "clearBackgroundCaches") {
    clearBackgroundCaches()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

self.addEventListener("error", (event) => {
  console.error("Background script error:", event.error);
});
