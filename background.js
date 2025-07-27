// Rate Limiter and Cache for Currency APIs
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
    if (this.canMakeRequest()) {
      this.requests.push(Date.now());
      return true;
    }
    return false;
  }
}

const apiRateLimiter = new RateLimiter(15, 60000);
const rateCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

const API_BACKOFF_DURATION = 5 * 60 * 1000; // 5 minutes

const CURRENCY_APIS = [
  {
    name: "frankfurter",
    url: (base, targets) =>
      `https://api.frankfurter.app/latest?from=${base.toUpperCase()}&to=${targets.toUpperCase()}`,
    parseResponse: (data, targets) => {
      if (!data.rates) return null;
      const rates = {};
      for (const target of targets) {
        const rate = data.rates[target.toUpperCase()];
        if (rate) {
          rates[target.toUpperCase()] = rate;
        }
      }
      return rates;
    },
    disabledUntil: 0,
  },
  {
    name: "exchangerate.host",
    url: (base, targets) =>
      `https://api.exchangerate.host/latest?base=${base.toUpperCase()}&symbols=${targets.toUpperCase()}`,
    parseResponse: (data, targets) => {
      if (!data.rates) return null;
      const rates = {};
      for (const target of targets) {
        const rate = data.rates[target.toUpperCase()];
        if (rate) {
          rates[target.toUpperCase()] = rate;
        }
      }
      return rates;
    },
    disabledUntil: 0,
  },
];

const TRANSLATION_API = {
  name: "lingva",
  baseUrl: "https://lingva.ml/api/v1/translate", // Base URL for POST requests
  parseResponse: (data) => data.translatedText, // Assuming data.translatedText is an array of translated strings
  disabledUntil: 0,
};

// Manejar actualizaciones de la extensión
chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

// Unified alarm listener for all alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch((e) => {
          // Ignorar errores si el tab no puede recibir mensajes
        });
      });
    });
  } else if (alarm.name === "deepCleanup") {
    // Limpieza profunda cada hora
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, { action: "deepCleanup" })
          .catch(() => {});
      });
    });
  }
});

// Crear alarma adicional para limpieza profunda
chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });

// Improved message handling with error catching
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getRates") {
    // Changed from getRate to getRates
    const { fromCurrencies, toCurrency } = request.payload;
    (async () => {
      if (!fromCurrencies || fromCurrencies.length === 0) {
        sendResponse({ rates: {} });
        return;
      }

      if (!apiRateLimiter.canMakeRequest()) {
        sendResponse({ error: "Rate limit exceeded" });
        return;
      }

      // Check cache first for all requested rates
      const rates = {};
      const currenciesToFetch = [];
      for (const from of fromCurrencies) {
        const cacheKey = `${from}_${toCurrency}`;
        const cached = rateCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          rates[from] = cached.rate;
        } else {
          currenciesToFetch.push(from);
        }
      }

      if (currenciesToFetch.length === 0) {
        sendResponse({ rates });
        return;
      }

      const errors = [];
      for (const api of CURRENCY_APIS) {
        if (Date.now() < api.disabledUntil) {
          errors.push(`${api.name} is temporarily disabled.`);
          continue;
        }

        let lastError = null;
        for (let i = 0; i < 2; i++) {
          try {
            if (!apiRateLimiter.makeRequest()) {
              throw new Error("Global rate limit exceeded");
            }

            const symbols = currenciesToFetch.join(",");
            const url = api.url(toCurrency, symbols); // Base currency is now toCurrency

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const response = await fetch(url, {
              signal: controller.signal,
              headers: { "User-Agent": "Currency Translator Extension" },
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const fetchedRates = api.parseResponse(data, currenciesToFetch);

            if (fetchedRates) {
              for (const from of currenciesToFetch) {
                const rate = fetchedRates[from.toUpperCase()];
                if (rate && rate > 0 && isFinite(rate)) {
                  const cacheKey = `${from}_${toCurrency}`;
                  rateCache.set(cacheKey, { rate, timestamp: Date.now() });
                  rates[from] = rate;
                }
              }
              api.disabledUntil = 0; // Reset on success
              sendResponse({ rates });
              return;
            }
            throw new Error("Invalid rate data received");
          } catch (error) {
            lastError = error;
            if (i < 1) await new Promise((res) => setTimeout(res, 500));
          }
        }
        api.disabledUntil = Date.now() + API_BACKOFF_DURATION;
        errors.push(
          `${api.name} failed after 1 retry and is disabled for 5 minutes. Error: ${lastError.message}`
        );
      }

      sendResponse({ error: `All currency APIs failed: ${errors.join(", ")}` });
    })();
    return true;
  } else if (request.action === "translateBatch") {
    const { texts, targetLang } = request.payload;
    (async () => {
      if (!texts || texts.length === 0) {
        sendResponse({ translations: [] });
        return;
      }

      if (Date.now() < TRANSLATION_API.disabledUntil) {
        sendResponse({ error: "Translation API is temporarily disabled." });
        return;
      }

      let lastError = null;
      for (let i = 0; i < 2; i++) {
        try {
          console.log(`[API] Translating batch of texts: ${texts.length} items`);
          const response = await fetch(TRANSLATION_API.baseUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              q: texts,
              source: "auto",
              target: targetLang,
              format: "text",
            }),
            signal: AbortSignal.timeout(10000),
          });

          if (!response.ok) {
            throw new Error(
              `API request failed with status ${response.status}`
            );
          }

          const data = await response.json();
          TRANSLATION_API.disabledUntil = 0; // Reset on success
          sendResponse({ translations: TRANSLATION_API.parseResponse(data) });
          return;
        } catch (error) {
          lastError = error;
          if (i < 1) await new Promise((res) => setTimeout(res, 500)); // Wait before retry
        }
      }

      // Both attempts failed
      TRANSLATION_API.disabledUntil = Date.now() + API_BACKOFF_DURATION;
      sendResponse({
        error: `Translation API failed after 1 retry and is disabled for 5 minutes. Error: ${lastError.message}`,
      });
    })();
    return true;
  }
  else if (
    ["done", "error", "progress", "updateStats"].includes(request.action)
  ) {
    chrome.runtime.sendMessage(request).catch(() => {});
  } else if (request.action === "getSettings") {
    // Example for handling a request from the popup
    chrome.storage.sync.get(null, sendResponse); // Send all settings
    return true; // Keep the channel open for sendResponse
  }
});

// Catch unhandled errors in the service worker
self.addEventListener("error", (event) => {
  console.error("Background script error:", event.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // Solo activar en páginas web (no en chrome://, about:, etc.)
    if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
      chrome.action.enable(tabId);
    } else {
      chrome.action.disable(tabId);
    }
  }
});

// Enhanced cleanup on suspend
chrome.runtime.onSuspend.addListener(() => {
  // Clear any pending alarms
  chrome.alarms.clearAll();

  // Clean up any remaining timeouts
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: "cleanup" }).catch((e) => {
        console.warn("Cleanup message failed for tab", tab.id, ":", e);
      });
    });
  });
});

// Improved installation handling and alarm creation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    const defaultSettings = {
      currency: "EUR",
      language: "en",
      msgTimeout: 3,
      autoProcess: true,
      showStats: false,
      stats: { conversions: 0, translations: 0 },
    };
    chrome.storage.sync.set(defaultSettings).then(() => {
      // Create cache cleanup alarms after settings are initialized
      chrome.alarms.create("clearCache", { periodInMinutes: 15 });
      chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });
    });
  }
});
