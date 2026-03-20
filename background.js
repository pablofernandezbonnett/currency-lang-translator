try {
  importScripts("utils.js");
} catch (error) {
  // `utils.js` is optional at runtime; fall back to local helpers if needed.
}

const _getErrorMessage =
  typeof getErrorMessage === "function"
    ? getErrorMessage
    : (error) => {
        if (!error) return "Unknown error";
        if (typeof error === "string") return error;
        return error && error.message ? String(error.message) : String(error);
      };

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
  language: "en",
  msgTimeout: 3,
  autoProcess: true,
  showStats: false,
  compactMode: false,
  consentApi: false,
  stats: { conversions: 0, translations: 0 },
};

const CACHE_DURATION = 10 * 60 * 1000;
const API_BACKOFF_DURATION = 5 * 60 * 1000;
const TRANSLATION_DELAY = 250;
const TRANSLATION_ITEM_TTL = 2 * 60 * 1000;
const MAX_TRANSLATION_QUEUE = 300;
const REQUEST_TIMEOUT_MS = 5000;
const RATE_CACHE_STORAGE_KEY = "rateCacheSnapshot";
const CLEAR_CACHE_ALARM_PERIOD_MINUTES = 15;
const DEEP_CLEANUP_ALARM_PERIOD_MINUTES = 60;

const apiRateLimiter = new RateLimiter(15, 60000);
const rateCache = new Map();
let translationQueue = [];
let isProcessingTranslationQueue = false;
const activeTranslationRequests = new Map();

const CURRENCY_APIS = [
  {
    name: "frankfurter",
    url: (base, target) =>
      `https://api.frankfurter.app/latest?from=${base.toUpperCase()}&to=${target.toUpperCase()}`,
    parseResponse: (data, target) =>
      data && data.rates ? data.rates[target.toUpperCase()] : null,
    disabledUntil: 0,
  },
  {
    name: "exchangerate.host",
    url: (base, target) =>
      `https://api.exchangerate.host/latest?base=${base.toUpperCase()}&symbols=${target.toUpperCase()}`,
    parseResponse: (data, target) =>
      data && data.rates ? data.rates[target.toUpperCase()] : null,
    disabledUntil: 0,
  },
];

const TRANSLATION_APIS = [
  {
    name: "lingva-official",
    url: (source, target, text) =>
      `https://lingva.ml/api/v1/${source}/${target}/${encodeURIComponent(text)}`,
    parseResponse: (data) => data.translation,
    disabledUntil: 0,
  },
  {
    name: "lingva-plausibility",
    url: (source, target, text) =>
      `https://translate.plausibility.cloud/api/v1/${source}/${target}/${encodeURIComponent(text)}`,
    parseResponse: (data) => data.translation,
    disabledUntil: 0,
  },
  {
    name: "lingva-segfault",
    url: (source, target, text) =>
      `https://translate.projectsegfau.lt/api/v1/${source}/${target}/${encodeURIComponent(text)}`,
    parseResponse: (data) => data.translation,
    disabledUntil: 0,
  },
  {
    name: "mymemory",
    requiresSourceLang: true,
    url: (source, target, text) =>
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text
      )}&langpair=${encodeURIComponent(`${source}|${target}`)}&mt=1`,
    parseResponse: (data) =>
      data &&
      data.responseData &&
      typeof data.responseData.translatedText === "string"
        ? data.responseData.translatedText
        : null,
    disabledUntil: 0,
  },
];

async function ensureAlarm(name, periodInMinutes) {
  const alarm = await chrome.alarms.get(name);
  if (!alarm) {
    chrome.alarms.create(name, { periodInMinutes });
  }
}

async function ensureRequiredAlarms() {
  await Promise.all([
    ensureAlarm("clearCache", CLEAR_CACHE_ALARM_PERIOD_MINUTES),
    ensureAlarm("deepCleanup", DEEP_CLEANUP_ALARM_PERIOD_MINUTES),
  ]);
}

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

    if (typeof saveToStorage === "function") {
      await saveToStorage({ [RATE_CACHE_STORAGE_KEY]: snapshot });
      return;
    }

    await chrome.storage.local.set({ [RATE_CACHE_STORAGE_KEY]: snapshot });
  } catch (error) {
    console.warn("Failed to persist rate cache:", _getErrorMessage(error));
  }
}

async function rehydrateRateCache() {
  try {
    let snapshot = null;

    if (typeof loadFromStorage === "function") {
      const stored = await loadFromStorage([RATE_CACHE_STORAGE_KEY]);
      snapshot = stored && stored[RATE_CACHE_STORAGE_KEY];
    } else {
      const stored = await chrome.storage.local.get([RATE_CACHE_STORAGE_KEY]);
      snapshot = stored && stored[RATE_CACHE_STORAGE_KEY];
    }

    if (!Array.isArray(snapshot)) {
      return;
    }

    const now = Date.now();
    for (const item of snapshot) {
      if (
        item &&
        item.key &&
        item.value &&
        now - item.value.timestamp < CACHE_DURATION
      ) {
        rateCache.set(item.key, item.value);
      }
    }
  } catch (error) {
    console.warn("Failed to rehydrate rate cache:", _getErrorMessage(error));
  }
}

function cleanupTranslationQueue() {
  const now = Date.now();

  for (let index = translationQueue.length - 1; index >= 0; index -= 1) {
    const item = translationQueue[index];
    if (!item || (item.addedAt && now - item.addedAt > TRANSLATION_ITEM_TTL)) {
      item?.sendResponse?.({ error: "Translation request expired." });
      translationQueue.splice(index, 1);
    }
  }

  if (translationQueue.length > MAX_TRANSLATION_QUEUE) {
    const droppedItems = translationQueue.splice(
      0,
      translationQueue.length - MAX_TRANSLATION_QUEUE
    );
    droppedItems.forEach((item) => {
      item?.sendResponse?.({ error: "Translation queue trimmed due to size limits." });
    });
  }
}

async function fetchJsonWithTimeout(url, externalSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromExternalSignal = () => controller.abort();

  try {
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", abortFromExternalSignal, {
          once: true,
        });
      }
    }

    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abortFromExternalSignal);
    }
    clearTimeout(timeoutId);
  }
}

async function fetchRateForCurrency(fromCurrency, toCurrency) {
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

        const controller = new AbortController();
        const url = api.url(fromCurrency, toCurrency);
        const data = await fetchJsonWithTimeout(url, controller.signal);
        const rate = api.parseResponse(data, toCurrency);

        if (!Number.isFinite(rate) || rate <= 0) {
          throw new Error("Invalid rate data received");
        }

        api.disabledUntil = 0;
        rateCache.set(cacheKey, { rate, timestamp: Date.now() });
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
      `${api.name} failed after 1 retry and is disabled for 5 minutes. Error: ${_getErrorMessage(
        lastError
      )}`
    );
  }

  return { error: errors.join(", ") || "All currency APIs failed." };
}

async function clearBackgroundCaches() {
  rateCache.clear();

  for (const api of CURRENCY_APIS) {
    api.disabledUntil = 0;
  }

  for (const api of TRANSLATION_APIS) {
    api.disabledUntil = 0;
  }

  for (const item of translationQueue) {
    item.controller?.abort();
  }
  translationQueue = [];

  for (const controller of activeTranslationRequests.values()) {
    controller.abort();
  }
  activeTranslationRequests.clear();

  if (typeof promisifyChrome === "function") {
    await promisifyChrome(chrome.storage.local.remove, RATE_CACHE_STORAGE_KEY);
  } else {
    await chrome.storage.local.remove(RATE_CACHE_STORAGE_KEY);
  }
}

async function processTranslationQueue() {
  if (isProcessingTranslationQueue || translationQueue.length === 0) {
    return;
  }

  isProcessingTranslationQueue = true;

  while (translationQueue.length > 0) {
    const item = translationQueue.shift();
    if (!item) {
      continue;
    }

    const { text, targetLang, sourceLang, sendResponse, controller, tabId } = item;

    if (!text || !text.trim()) {
      sendResponse({ translation: "" });
      continue;
    }

    if (typeof tabId === "number") {
      activeTranslationRequests.set(tabId, controller);
    }

    let lastError = null;
    let translated = false;

    try {
      const effectiveSourceLang =
        typeof sourceLang === "string" && sourceLang ? sourceLang : "auto";

      for (const api of TRANSLATION_APIS) {
        if (Date.now() < api.disabledUntil) {
          continue;
        }

        if (api.requiresSourceLang && effectiveSourceLang === "auto") {
          continue;
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const url = api.url(effectiveSourceLang, targetLang, text);
            const data = await fetchJsonWithTimeout(url, controller.signal);
            const translation = api.parseResponse(data);

            if (!translation || translation === text) {
              throw new Error("Empty translation received");
            }

            api.disabledUntil = 0;
            sendResponse({ translation });
            lastError = null;
            translated = true;
            break;
          } catch (error) {
            lastError = error;

            if (error.name === "AbortError") {
              sendResponse({ error: "Translation aborted." });
              translated = true;
              break;
            }

            if (attempt === 0) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }
        }

        if (translated) {
          break;
        }

        api.disabledUntil = Date.now() + API_BACKOFF_DURATION;
      }

      if (!translated && lastError && lastError.name !== "AbortError") {
        sendResponse({
          error: `All translation APIs failed. Last error: ${_getErrorMessage(lastError)}`,
        });
      }
    } finally {
      if (typeof tabId === "number") {
        activeTranslationRequests.delete(tabId);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, TRANSLATION_DELAY));
  }

  isProcessingTranslationQueue = false;
}

setInterval(() => {
  persistRateCache().catch(() => {});
  cleanupTranslationQueue();
}, 60 * 1000);

rehydrateRateCache().catch(() => {});
ensureRequiredAlarms().catch(() => {});
initializeDefaultSettings().catch(() => {});

chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    clearBackgroundCaches().catch(() => {});
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch(() => {
          // Ignore tabs that cannot receive extension messages.
        });
      });
    });
  }

  if (alarm.name === "deepCleanup") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "deepCleanup" }).catch(() => {
          // Ignore tabs that cannot receive extension messages.
        });
      });
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureRequiredAlarms().catch(() => {});
  initializeDefaultSettings().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  ensureRequiredAlarms().catch(() => {});
  initializeDefaultSettings().catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getRates") {
    const payload = request.payload || {};
    const fromCurrencies = Array.isArray(payload.fromCurrencies)
      ? [...new Set(payload.fromCurrencies.map((value) => String(value).toUpperCase()))]
      : [];
    const toCurrency = payload.toCurrency ? String(payload.toCurrency).toUpperCase() : "";

    (async () => {
      if (!toCurrency || fromCurrencies.length === 0) {
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
      sendResponse({ error: _getErrorMessage(error) });
    });

    return true;
  }

  if (request.action === "translate") {
    const payload = request.payload || {};
    const text = typeof payload.text === "string" ? payload.text : "";
    const targetLang = payload.targetLang ? String(payload.targetLang) : "en";
    const sourceLang = payload.sourceLang ? String(payload.sourceLang) : "auto";
    const tabId = sender.tab ? sender.tab.id : null;
    const controller = new AbortController();

    cleanupTranslationQueue();

    if (translationQueue.length >= MAX_TRANSLATION_QUEUE) {
      sendResponse({ error: "Translation queue is full. Try again later." });
      return false;
    }

    translationQueue.push({
      text,
      targetLang,
      sourceLang,
      sendResponse,
      controller,
      tabId,
      addedAt: Date.now(),
    });

    processTranslationQueue().catch((error) => {
      console.error("Translation queue error:", _getErrorMessage(error));
    });

    return true;
  }

  if (request.action === "cancelTranslation") {
    const tabId = sender.tab ? sender.tab.id : null;

    if (typeof tabId === "number") {
      activeTranslationRequests.get(tabId)?.abort();

      translationQueue = translationQueue.filter((item) => {
        if (item.tabId === tabId) {
          item.controller?.abort();
          return false;
        }

        return true;
      });
    }

    return false;
  }

  if (request.action === "clearBackgroundCaches") {
    clearBackgroundCaches()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ error: _getErrorMessage(error) }));
    return true;
  }

  if (request.action === "getSettings") {
    chrome.storage.sync
      .get(null)
      .then((settings) => sendResponse(settings))
      .catch((error) => sendResponse({ error: _getErrorMessage(error) }));
    return true;
  }

  return false;
});

self.addEventListener("error", (event) => {
  console.error("Background script error:", event.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) {
    return;
  }

  if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
    chrome.action.enable(tabId);
    return;
  }

  chrome.action.disable(tabId);
});

chrome.runtime.onSuspend.addListener(() => {
  persistRateCache().catch(() => {});
});
