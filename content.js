(async () => {
  const CACHE_DURATION = 10 * 60 * 1000;
  const CLEANUP_INTERVAL = 5 * 60 * 1000;
  const PROCESS_DEBOUNCE_MS = 1000;
  const MAX_PROCESS_TARGETS = 200;
  const STATS_SAVE_DEBOUNCE_MS = 3000;
  const NODE_ORIGINAL_TEXT_KEY = "__currencyTranslatorOriginalText";
  const NODE_PROCESSED_TEXT_KEY = "__currencyTranslatorProcessedText";
  const NUMBER_PATTERN_FRAGMENT =
    "[0-9]{1,3}(?:[,\\s]?[0-9]{3})*(?:\\.[0-9]{1,2})?";
  const AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT =
    `${NUMBER_PATTERN_FRAGMENT}(?:[KMB])?\\b`;
  const DETECTED_AMOUNT_PATTERN = new RegExp(
    `(${NUMBER_PATTERN_FRAGMENT})([KMB])?\\b`,
    "i"
  );
  const COMPACT_NUMBER_MULTIPLIERS = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
  };

  const CURRENCY_DETECTORS = {
    JPY: /(?:¥|JPY\b|円)/i,
    USD: /(?:\$|USD\b)/i,
    EUR: /(?:€|EUR\b)/i,
    GBP: /(?:£|GBP\b)/i,
    CNY: /(?:CNY\b|RMB\b|CN¥|人民币|元)/i,
    KRW: /(?:₩|KRW\b)/i,
  };

  const CURRENCY_PATTERNS = {
    JPY: new RegExp(
      `(?:¥|JPY\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}|${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}\\s*円`,
      "gi"
    ),
    USD: new RegExp(
      `(?:\\$|USD\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
    EUR: new RegExp(
      `(?:€|EUR\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
    GBP: new RegExp(
      `(?:£|GBP\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
    CNY: new RegExp(
      `(?:CNY\\s*|RMB\\s*|CN¥\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
    KRW: new RegExp(
      `(?:₩|KRW\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
  };

  const BLOCK_TAGS = new Set([
    "ARTICLE",
    "ASIDE",
    "DIV",
    "FOOTER",
    "HEADER",
    "LI",
    "MAIN",
    "P",
    "SECTION",
    "TD",
    "TR",
  ]);

  const SKIPPED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "SVG",
    "TEXTAREA",
    "INPUT",
  ]);

  let isProcessing = false;
  let mutationObserver = null;
  let processingQueue = Promise.resolve();
  let stats = { conversions: 0 };
  let statsSaveTimeout = null;
  let suppressMutationsUntil = 0;
  let extensionContextInvalidated = false;

  const rateCache = new Map();

  function getErrorMessage(error) {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    return error && error.message ? String(error.message) : String(error);
  }

  function normalizeStats(value) {
    return {
      conversions:
        value && Number.isFinite(value.conversions) ? value.conversions : 0,
    };
  }

  function isContextInvalidatedError(error) {
    return getErrorMessage(error).includes("Extension context invalidated");
  }

  function markContextInvalidated(error) {
    if (!isContextInvalidatedError(error)) {
      return false;
    }

    extensionContextInvalidated = true;
    mutationObserver?.disconnect();
    return true;
  }

  function sendRuntimeMessage(message) {
    if (extensionContextInvalidated) {
      return Promise.resolve(null);
    }

    try {
      return chrome.runtime.sendMessage(message).catch((error) => {
        if (markContextInvalidated(error)) {
          return null;
        }

        console.warn("Runtime message failed:", getErrorMessage(error));
        return null;
      });
    } catch (error) {
      if (!markContextInvalidated(error)) {
        console.warn("Runtime message failed:", getErrorMessage(error));
      }

      return Promise.resolve(null);
    }
  }

  async function getSyncStorage(keys) {
    if (extensionContextInvalidated) {
      return {};
    }

    try {
      return await chrome.storage.sync.get(keys);
    } catch (error) {
      if (markContextInvalidated(error)) {
        return {};
      }

      throw error;
    }
  }

  async function setSyncStorage(value) {
    if (extensionContextInvalidated) {
      return false;
    }

    try {
      await chrome.storage.sync.set(value);
      return true;
    } catch (error) {
      if (markContextInvalidated(error)) {
        return false;
      }

      throw error;
    }
  }

  function initializeSecurity() {
    if (window.currencyTranslatorInjected || window.currencyTranslatorProcessed) {
      return false;
    }

    if (!["http:", "https:"].includes(window.location.protocol)) {
      return false;
    }

    if (
      [
        "chrome-extension:",
        "moz-extension:",
        "about:",
        "javascript:",
      ].some((value) => window.location.href.includes(value))
    ) {
      return false;
    }

    window.currencyTranslatorInjected = true;
    window.currencyTranslatorProcessed = true;
    return true;
  }

  function getNodeOriginalText(node) {
    return typeof node[NODE_ORIGINAL_TEXT_KEY] === "string"
      ? node[NODE_ORIGINAL_TEXT_KEY]
      : null;
  }

  function getNodeProcessedText(node) {
    return typeof node[NODE_PROCESSED_TEXT_KEY] === "string"
      ? node[NODE_PROCESSED_TEXT_KEY]
      : null;
  }

  function markNodeState(node, originalText, processedText) {
    node[NODE_ORIGINAL_TEXT_KEY] = originalText;
    node[NODE_PROCESSED_TEXT_KEY] = processedText;
  }

  function suppressMutationHandlingFor(delayMs = PROCESS_DEBOUNCE_MS * 2) {
    suppressMutationsUntil = Date.now() + delayMs;
  }

  function isMutationHandlingSuppressed() {
    return Date.now() < suppressMutationsUntil;
  }

  function resetProcessedState({ restoreOriginal = false, clearOriginal = false } = {}) {
    if (!document.body) {
      return;
    }

    suppressMutationHandlingFor();

    walkTextNodes(document.body, (node) => {
      const originalText = getNodeOriginalText(node);

      if (restoreOriginal && originalText && node.nodeValue !== originalText) {
        node.nodeValue = originalText;
      }

      delete node[NODE_PROCESSED_TEXT_KEY];

      if (clearOriginal) {
        delete node[NODE_ORIGINAL_TEXT_KEY];
      }
    });
  }

  function cleanupCache() {
    const now = Date.now();

    for (const [key, value] of rateCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        rateCache.delete(key);
      }
    }
  }

  function initializeCleanup() {
    setInterval(cleanupCache, CLEANUP_INTERVAL);

    window.addEventListener("beforeunload", () => {
      cleanupCache();
    });
  }

  async function loadStats() {
    try {
      const result = await getSyncStorage(["stats"]);
      if (result.stats) {
        stats = normalizeStats(result.stats);
      }
    } catch (error) {
      console.warn("Error loading stats:", getErrorMessage(error));
    }
  }

  function saveStats() {
    sendRuntimeMessage({ action: "updateStats", stats });

    if (statsSaveTimeout || extensionContextInvalidated) {
      return;
    }

    statsSaveTimeout = setTimeout(async () => {
      statsSaveTimeout = null;

      try {
        await setSyncStorage({ stats });
      } catch (error) {
        console.warn("Error saving stats:", getErrorMessage(error));
      }
    }, STATS_SAVE_DEBOUNCE_MS);
  }

  async function requestExchangeRates(fromCurrencies, toCurrency) {
    if (!Array.isArray(fromCurrencies) || fromCurrencies.length === 0) {
      return {};
    }

    const rates = {};
    const currenciesToFetch = [];

    for (const currency of fromCurrencies) {
      if (currency === toCurrency) {
        rates[currency] = 1;
        continue;
      }

      const cacheKey = `${currency}_${toCurrency}`;
      const cached = rateCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        rates[currency] = cached.rate;
      } else {
        currenciesToFetch.push(currency);
      }
    }

    if (currenciesToFetch.length === 0) {
      return rates;
    }

    try {
      const response = await sendRuntimeMessage({
        action: "getRates",
        payload: { fromCurrencies: currenciesToFetch, toCurrency },
      });

      if (response && response.rates) {
        for (const [currency, rate] of Object.entries(response.rates)) {
          rateCache.set(`${currency}_${toCurrency}`, {
            rate,
            timestamp: Date.now(),
          });
          rates[currency] = rate;
        }
      }

      if (response && response.warning) {
        console.warn("Exchange-rate warning:", response.warning);
      }
    } catch (error) {
      console.warn("Failed to request exchange rates:", getErrorMessage(error));
    }

    return rates;
  }

  function detectCurrenciesOnPage() {
    const textContent = document.body?.innerText || "";

    return Object.entries(CURRENCY_DETECTORS)
      .filter(([, pattern]) => pattern.test(textContent))
      .map(([currency]) => currency);
  }

  async function getExchangeRatesForPage(userCurrency) {
    const currencies = detectCurrenciesOnPage().filter(
      (currency) => currency !== userCurrency
    );

    if (currencies.length === 0) {
      return {};
    }

    return requestExchangeRates(currencies, userCurrency);
  }

  function getUserCurrencySymbol(currency) {
    const symbols = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      CNY: "¥",
      KRW: "₩",
    };

    return symbols[currency] || `${currency} `;
  }

  function formatConversion(match, convertedValue, userCurrency, compactMode) {
    const convertedText = `${getUserCurrencySymbol(userCurrency)}${convertedValue}`;
    return compactMode
      ? `${match} ≈ ${convertedText}`
      : `${match} (≈ ${convertedText})`;
  }

  function parseDetectedAmount(match) {
    const amountMatch = String(match).match(DETECTED_AMOUNT_PATTERN);

    if (!amountMatch) {
      return null;
    }

    const numericValue = parseFloat(amountMatch[1].replace(/[,\s]/g, ""));

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null;
    }

    const compactSuffix = amountMatch[2]
      ? amountMatch[2].toUpperCase()
      : "";

    return numericValue * (COMPACT_NUMBER_MULTIPLIERS[compactSuffix] || 1);
  }

  function convertCurrencies(text, rates, userCurrency, compactMode) {
    let convertedText = text;
    let conversionsFound = 0;

    for (const [currency, pattern] of Object.entries(CURRENCY_PATTERNS)) {
      if (!rates[currency] || currency === userCurrency) {
        continue;
      }

      convertedText = convertedText.replace(pattern, (match) => {
        const numericValue = parseDetectedAmount(match);

        if (!numericValue) {
          return match;
        }

        conversionsFound += 1;
        return formatConversion(
          match,
          (numericValue * rates[currency]).toFixed(2),
          userCurrency,
          compactMode
        );
      });
    }

    if (conversionsFound > 0) {
      stats.conversions += conversionsFound;
      saveStats();
    }

    return convertedText;
  }

  function walkTextNodes(root, visitor) {
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIPPED_TAGS.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      visitor(currentNode);
    }
  }

  function getBlockAncestor(node) {
    let element = node.parentElement;

    while (element && element !== document.body) {
      if (BLOCK_TAGS.has(element.tagName)) {
        return element;
      }
      element = element.parentElement;
    }

    return document.body;
  }

  function collectProcessTargets() {
    const targets = [];
    const seen = new Set();

    walkTextNodes(document.body, (node) => {
      const block = getBlockAncestor(node);
      if (!block || seen.has(block)) {
        return;
      }

      seen.add(block);
      targets.push(block);
    });

    if (targets.length === 0) {
      return document.body ? [document.body] : [];
    }

    const viewportHeight = window.innerHeight || 0;

    return targets
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();

        const leftVisible =
          leftRect.height > 0 &&
          leftRect.width > 0 &&
          leftRect.bottom > 0 &&
          leftRect.top < viewportHeight;
        const rightVisible =
          rightRect.height > 0 &&
          rightRect.width > 0 &&
          rightRect.bottom > 0 &&
          rightRect.top < viewportHeight;

        if (leftVisible !== rightVisible) {
          return leftVisible ? -1 : 1;
        }

        const leftDistance = leftVisible
          ? 0
          : Math.min(
              Math.abs(leftRect.top),
              Math.abs(leftRect.bottom - viewportHeight)
            );
        const rightDistance = rightVisible
          ? 0
          : Math.min(
              Math.abs(rightRect.top),
              Math.abs(rightRect.bottom - viewportHeight)
            );

        if (leftDistance !== rightDistance) {
          return leftDistance - rightDistance;
        }

        return leftRect.top - rightRect.top;
      })
      .slice(0, MAX_PROCESS_TARGETS);
  }

  function prepareTextNode(node, rates, userCurrency, compactMode) {
    const currentText = node.nodeValue ? node.nodeValue.trim() : "";
    if (!currentText || currentText.length < 2) {
      return null;
    }

    const storedOriginal = getNodeOriginalText(node);
    const lastProcessed = getNodeProcessedText(node);

    let originalText = currentText;
    if (storedOriginal && lastProcessed && currentText === lastProcessed) {
      return null;
    }

    if (storedOriginal && lastProcessed && currentText !== lastProcessed) {
      originalText = currentText;
    } else if (storedOriginal && !lastProcessed) {
      originalText = storedOriginal;
    }

    let processedText = originalText;
    if (Object.keys(rates).length > 0) {
      processedText = convertCurrencies(processedText, rates, userCurrency, compactMode);
    }

    return {
      node,
      originalText,
      finalText: processedText !== originalText ? processedText : originalText,
    };
  }

  async function processDOM(root, options) {
    walkTextNodes(root, (node) => {
      const candidate = prepareTextNode(
        node,
        options.rates,
        options.userCurrency,
        options.compactMode
      );

      if (!candidate) {
        return;
      }

      if (node.nodeValue !== candidate.finalText) {
        node.nodeValue = candidate.finalText;
      }

      markNodeState(node, candidate.originalText, candidate.finalText);
    });
  }

  async function runCurrencyConversion() {
    if (isProcessing) {
      return processingQueue;
    }

    processingQueue = processingQueue.then(async () => {
      isProcessing = true;
      suppressMutationHandlingFor();

      try {
        sendRuntimeMessage({
          action: "progress",
          message: "Loading settings...",
        });

        await loadStats();

        const settings = await getSyncStorage(["currency", "compactMode"]);

        const userCurrency = settings.currency || "EUR";
        const compactMode = settings.compactMode === true;

        sendRuntimeMessage({
          action: "progress",
          message: "Fetching exchange rates...",
        });

        const rates = await getExchangeRatesForPage(userCurrency);
        const targets = collectProcessTargets();

        sendRuntimeMessage({
          action: "progress",
          message: "Processing content...",
        });

        for (const target of targets) {
          await processDOM(target, {
            rates,
            userCurrency,
            compactMode,
          });
        }

        sendRuntimeMessage({ action: "done" });
      } catch (error) {
        console.error("Error in runCurrencyConversion:", error);
        sendRuntimeMessage({
          action: "error",
          error: getErrorMessage(error),
        });
      } finally {
        isProcessing = false;
        suppressMutationHandlingFor();
      }
    });

    return processingQueue;
  }

  function debounce(callback, wait) {
    let timeoutId = null;

    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        timeoutId = null;
        callback(...args);
      }, wait);
    };
  }

  const debouncedProcessing = debounce(() => {
    if (isProcessing || isMutationHandlingSuppressed()) {
      return;
    }

    getSyncStorage(["autoProcess"])
      .then(({ autoProcess }) => {
        if (autoProcess !== false) {
          runCurrencyConversion();
        }
      })
      .catch((error) => {
        console.warn("Error reading autoProcess setting:", getErrorMessage(error));
      });
  }, PROCESS_DEBOUNCE_MS);

  function initializeObservers() {
    mutationObserver = new MutationObserver(debouncedProcessing);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  chrome.runtime.onMessage.addListener((request) => {
    switch (request.action) {
      case "reprocess":
        resetProcessedState({ restoreOriginal: true, clearOriginal: false });
        cleanupCache();
        runCurrencyConversion();
        break;
      case "clearCache":
        rateCache.clear();
        resetProcessedState({ restoreOriginal: true, clearOriginal: true });
        sendRuntimeMessage({ action: "done" });
        break;
      case "deepCleanup":
        cleanupCache();
        break;
      case "cleanup":
        cleanupCache();
        mutationObserver?.disconnect();
        break;
      default:
        break;
    }
  });

  window.addEventListener("error", (event) => {
    if (markContextInvalidated(event.error || event.message)) {
      return;
    }

    console.error("Content script error:", event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (markContextInvalidated(event.reason)) {
      return;
    }

    console.error("Unhandled content promise rejection:", event.reason);
  });

  if (!initializeSecurity()) {
    return;
  }

  initializeCleanup();

  const initialRun = () => {
    if (!document.body) {
      return;
    }

    initializeObservers();

    getSyncStorage(["autoProcess"])
      .then(({ autoProcess }) => {
        if (autoProcess !== false) {
          runCurrencyConversion();
        }
      })
      .catch((error) => {
        console.warn("Error reading autoProcess setting:", getErrorMessage(error));
      });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialRun, { once: true });
  } else {
    initialRun();
  }
})();
