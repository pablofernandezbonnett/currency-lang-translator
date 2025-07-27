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
  url: (source, target, text) =>
    `https://lingva.ml/api/v1/${source}/${target}/${encodeURIComponent(text)}`,
  parseResponse: (data) => data.translation, // Lingva returns 'translation' for single text
  disabledUntil: 0,
};

const translationQueue = [];
let isProcessingTranslationQueue = false;
const TRANSLATION_DELAY = 1000; // 1 second delay between translation requests

// Handle extension updates
chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

// Unified alarm listener for all alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch((e) => {
          // Ignore errors if the tab cannot receive messages
        });
      });
    });
  } else if (alarm.name === "deepCleanup") {
    // Deep cleanup every hour
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, { action: "deepCleanup" })
          .catch(() => {});
      });
    });
  }
});

// Create additional alarm for deep cleanup
chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });

async function processTranslationQueue() {
  if (isProcessingTranslationQueue || translationQueue.length === 0) {
    return;
  }

  isProcessingTranslationQueue = true;

  while (translationQueue.length > 0) {
    const { text, targetLang, sendResponse, controller } = translationQueue.shift();

    if (!text || !text.trim()) {
      sendResponse({ translation: "" });
      continue;
    }

    if (Date.now() < TRANSLATION_API.disabledUntil) {
      sendResponse({ error: "Translation API is temporarily disabled." });
      // Re-add to front of queue if API is disabled
      translationQueue.unshift({ text, targetLang, sendResponse, controller });
      isProcessingTranslationQueue = false;
      return;
    }

    let lastError = null;
    for (let i = 0; i < 2; i++) {
      try {
        console.log(`[API] Translating text: "${text}"`);
        const url = TRANSLATION_API.url("auto", targetLang, text);
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `API request failed with status ${response.status}`
          );
        }

        const data = await response.json();
        TRANSLATION_API.disabledUntil = 0; // Reset on success
        sendResponse({ translation: TRANSLATION_API.parseResponse(data) });
        break; // Exit retry loop on success
      } catch (error) {
        lastError = error;
        if (error.name === 'AbortError') {
          console.log(`Translation for "${text}" aborted.`);
          sendResponse({ error: "Translation aborted." });
          break; // Exit retry loop if aborted
        }
        if (i < 1) await new Promise((res) => setTimeout(res, 500)); // Wait before retry
      }
    }

    if (lastError && lastError.name !== 'AbortError') {
      // Both attempts failed and not an abort error
      TRANSLATION_API.disabledUntil = Date.now() + API_BACKOFF_DURATION;
      sendResponse({
        error: `Translation API failed after 1 retry and is disabled for 5 minutes. Error: ${lastError.message}`,
      });
    }

    // Add a delay before processing the next item in the queue
    await new Promise(resolve => setTimeout(resolve, TRANSLATION_DELAY));
  }

  isProcessingTranslationQueue = false;
}

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
  } else if (request.action === "translate") {
    const { text, targetLang } = request.payload;
    const tabId = sender.tab ? sender.tab.id : null;
    const controller = new AbortController();
    translationQueue.push({ text, targetLang, sendResponse, tabId, controller });
    if (!isProcessingTranslationQueue) {
      processTranslationQueue();
    }
    return true; // Required for asynchronous sendResponse
  } else if (request.action === "cancelTranslation") {
    const tabIdToCancel = sender.tab ? sender.tab.id : null;
    if (tabIdToCancel) {
      // Abort any ongoing requests for the cancelled tab
      translationQueue.forEach(req => {
        if (req.tabId === tabIdToCancel && req.controller) {
          req.controller.abort();
        }
      });
      // Filter out requests from the cancelled tab
      translationQueue = translationQueue.filter(req => req.tabId !== tabIdToCancel);
      console.log(`Cancelled translation requests for tab ${tabIdToCancel}. Remaining queue size: ${translationQueue.length}`);
    }
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
    // Only activate on web pages (not chrome://, about:, etc.)
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
      chrome.tabs.sendMessage(tab.id, { action: "cleanup" }).catch(() => {});
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