(async () => {
  const CACHE_DURATION = 10 * 60 * 1000;
  const PROCESS_DELAY_MS = 1000;
  const MAX_PROCESS_TARGETS = 200;
  const MAX_DIRTY_ROOTS = 200;
  const NUMBER_PATTERN_FRAGMENT =
    "(?:[0-9]{1,3}(?:[,\\s][0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,2})?";
  const AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT =
    `${NUMBER_PATTERN_FRAGMENT}(?:[KMB])?(?![\\w.,]|\\s+[0-9])`;
  const DETECTED_AMOUNT_PATTERN = new RegExp(
    `(${NUMBER_PATTERN_FRAGMENT})([KMB])?(?![\\w.,]|\\s+[0-9])`,
    "i"
  );
  const COMPACT_NUMBER_MULTIPLIERS = {
    K: 1e3,
    M: 1e6,
    B: 1e9,
  };

  const CURRENCY_PATTERNS = {
    CNY: new RegExp(
      `(?:CNY\\s*¥?\\s*|RMB\\s*¥?\\s*|CN[¥￥]\\s*|人民币\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}|${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}\\s*(?:人民币|元)`,
      "gi"
    ),
    JPY: new RegExp(
      `(?:(?<!CN)¥|￥|JPY\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}|${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}\\s*円`,
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
    KRW: new RegExp(
      `(?:₩|KRW\\s*)${AMOUNT_WITH_SUFFIX_PATTERN_FRAGMENT}`,
      "gi"
    ),
  };

  const SKIPPED_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "IFRAME",
    "SVG",
    "SELECT",
    "OPTION",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "TEXTAREA",
    "INPUT",
  ]);

  let isProcessing = false;
  let mutationObserver = null;
  let processingQueue = Promise.resolve();
  let pendingProcessing = false;
  let fullScanPending = true;
  let stateVersion = 0;
  let extensionContextInvalidated = false;

  const rateCache = new Map();
  const nodeState = new WeakMap();
  const dirtyRoots = new Set();

  function getErrorMessage(error) {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    return error && error.message ? String(error.message) : String(error);
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

  function isMissingMessageResponseError(error) {
    const message = getErrorMessage(error);
    return (
      message.includes("The message port closed before a response was received") ||
      message.includes("Could not establish connection. Receiving end does not exist")
    );
  }

  function sendRuntimeMessage(message, { expectResponse = true } = {}) {
    if (extensionContextInvalidated) {
      return Promise.resolve(null);
    }

    try {
      return chrome.runtime.sendMessage(message).catch((error) => {
        if (markContextInvalidated(error)) {
          return null;
        }

        if (!expectResponse && isMissingMessageResponseError(error)) {
          return null;
        }

        if (expectResponse) {
          throw error;
        }

        console.warn("Runtime message failed:", getErrorMessage(error));
        return null;
      });
    } catch (error) {
      if (markContextInvalidated(error)) {
        return Promise.resolve(null);
      }

      if (expectResponse) {
        return Promise.reject(error);
      }

      console.warn("Runtime message failed:", getErrorMessage(error));
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

  function observeMutations() {
    mutationObserver?.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function withoutObserving(callback) {
    mutationObserver?.disconnect();
    try {
      return callback();
    } finally {
      if (!extensionContextInvalidated && document.body) {
        observeMutations();
      }
    }
  }

  function resetProcessedState() {
    if (!document.body) {
      return;
    }

    stateVersion += 1;
    fullScanPending = true;
    withoutObserving(() => {
      walkTextNodes(document.body, (node) => {
        const state = nodeState.get(node);
        if (!state) {
          return;
        }

        if (node.nodeValue === state.processedText) {
          node.nodeValue = state.originalText;
        } else if (node.nodeValue.includes(state.processedText)) {
          node.nodeValue = node.nodeValue.replace(
            state.processedText,
            state.originalText
          );
        } else if (node.nodeValue.includes("≈")) {
          return;
        }
        nodeState.delete(node);
      });
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

      if (!response || response.error || !response.rates) {
        if (Object.keys(rates).length > 0) {
          console.warn("Exchange-rate warning:", response?.error || "Provider unavailable");
          return rates;
        }
        throw new Error(response?.error || "Unable to fetch exchange rates.");
      }

      for (const [currency, rate] of Object.entries(response.rates)) {
        rateCache.set(`${currency}_${toCurrency}`, {
          rate,
          timestamp: Date.now(),
        });
        rates[currency] = rate;
      }

      if (response.warning) {
        console.warn("Exchange-rate warning:", response.warning);
      }
    } catch (error) {
      throw new Error(`Failed to request exchange rates: ${getErrorMessage(error)}`);
    }

    return rates;
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

    const amount = numericValue * (COMPACT_NUMBER_MULTIPLIERS[compactSuffix] || 1);
    return Number.isFinite(amount) ? amount : null;
  }

  function findCurrencyMatches(text) {
    const matches = [];
    for (const [currency, pattern] of Object.entries(CURRENCY_PATTERNS)) {
      for (const match of text.matchAll(pattern)) {
        if (parseDetectedAmount(match[0]) !== null) {
          matches.push({ currency, text: match[0], index: match.index });
        }
      }
    }

    matches.sort((left, right) =>
      left.index - right.index || right.text.length - left.text.length
    );

    const distinct = [];
    let previousEnd = 0;
    for (const match of matches) {
      if (match.index < previousEnd) {
        continue;
      }
      distinct.push(match);
      previousEnd = match.index + match.text.length;
    }
    return distinct;
  }

  function convertCurrencies(text, matches, rates, userCurrency, compactMode) {
    let result = "";
    let cursor = 0;
    let count = 0;

    for (const match of matches) {
      result += text.slice(cursor, match.index);
      cursor = match.index + match.text.length;

      const rate = rates[match.currency];
      const amount = parseDetectedAmount(match.text);
      const converted = amount && rate ? amount * rate : null;
      if (match.currency === userCurrency || !Number.isFinite(converted)) {
        result += match.text;
        continue;
      }

      result += formatConversion(
        match.text,
        converted.toFixed(2),
        userCurrency,
        compactMode
      );
      count += 1;
    }

    return { text: result + text.slice(cursor), count };
  }

  function walkTextNodes(root, visitor) {
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }

        for (let element = parent; element; element = element.parentElement) {
          if (SKIPPED_TAGS.has(element.tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      visitor(currentNode);
    }
  }

  function getSourceText(node) {
    const currentText = node.nodeValue || "";
    if (currentText.trim().length < 2) {
      return null;
    }

    const state = nodeState.get(node);
    if (!state) {
      return currentText;
    }
    if (currentText === state.processedText) {
      return null;
    }
    if (currentText.includes(state.processedText)) {
      return currentText.replace(state.processedText, state.originalText);
    }
    return currentText.includes("≈") ? null : currentText;
  }

  function collectProcessTargets(roots) {
    const targets = [];
    const seen = new Set();
    const currencies = new Set();

    for (const root of roots) {
      walkTextNodes(root, (node) => {
        if (seen.has(node)) {
          return;
        }
        seen.add(node);

        const sourceText = getSourceText(node);
        if (!sourceText) {
          return;
        }

        const matches = findCurrencyMatches(sourceText);
        if (matches.length === 0) {
          return;
        }

        for (const match of matches) {
          currencies.add(match.currency);
        }
        targets.push({ node, currentText: node.nodeValue, sourceText, matches });
      });
    }

    const viewportHeight = window.innerHeight || 0;
    for (const target of targets) {
      const rect = target.node.parentElement.getBoundingClientRect();
      target.distance = rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < viewportHeight
        ? 0
        : rect.width === 0 || rect.height === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(Math.abs(rect.top), Math.abs(rect.bottom - viewportHeight));
    }
    targets.sort((left, right) => left.distance - right.distance);
    return { targets, currencies: [...currencies] };
  }

  async function runCurrencyConversion() {
    if (isProcessing) {
      pendingProcessing = true;
      return processingQueue;
    }

    isProcessing = true;
    processingQueue = (async () => {
      try {
        const version = stateVersion;
        const roots = fullScanPending
          ? [document.body]
          : [...dirtyRoots].filter((root) => root.isConnected);
        fullScanPending = false;
        dirtyRoots.clear();

        const { targets, currencies } = collectProcessTargets(roots);
        if (targets.length === 0) {
          return { ok: true, conversions: 0 };
        }
        const settings = await getSyncStorage(["currency", "compactMode"]);
        const userCurrency = settings.currency || "EUR";
        const compactMode = settings.compactMode === true;
        const rates = await requestExchangeRates(
          currencies.filter((currency) => currency !== userCurrency),
          userCurrency
        );

        if (version !== stateVersion) {
          fullScanPending = true;
          pendingProcessing = true;
          return { ok: false, error: "Settings changed during processing." };
        }

        let conversions = 0;
        let interrupted = false;
        for (let start = 0; start < targets.length; start += MAX_PROCESS_TARGETS) {
          if (version !== stateVersion) {
            fullScanPending = true;
            pendingProcessing = true;
            interrupted = true;
            break;
          }
          withoutObserving(() => {
            for (const target of targets.slice(start, start + MAX_PROCESS_TARGETS)) {
              if (!target.node.isConnected || target.node.nodeValue !== target.currentText) {
                continue;
              }
              const result = convertCurrencies(
                target.sourceText,
                target.matches,
                rates,
                userCurrency,
                compactMode
              );
              if (result.count === 0) {
                continue;
              }
              target.node.nodeValue = result.text;
              nodeState.set(target.node, {
                originalText: target.sourceText,
                processedText: result.text,
              });
              conversions += result.count;
            }
          });
          if (start + MAX_PROCESS_TARGETS < targets.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }

        if (conversions > 0) {
          sendRuntimeMessage(
            { action: "incrementStats", count: conversions },
            { expectResponse: false }
          );
        }
        return interrupted
          ? { ok: false, error: "Settings changed during processing." }
          : { ok: true, conversions };
      } catch (error) {
        console.error("Error in runCurrencyConversion:", error);
        return { ok: false, error: getErrorMessage(error) };
      } finally {
        isProcessing = false;
        if (pendingProcessing) {
          pendingProcessing = false;
          setTimeout(() => runAutoProcessing(), 0);
        }
      }
    })();

    return processingQueue;
  }

  function runAutoProcessing() {
    getSyncStorage(["autoProcess"])
      .then(({ autoProcess }) => {
        if (autoProcess !== false) {
          runCurrencyConversion();
        } else {
          dirtyRoots.clear();
          fullScanPending = true;
        }
      })
      .catch((error) => {
        console.warn("Error reading autoProcess setting:", getErrorMessage(error));
      });
  }

  let processTimeout = null;
  function scheduleProcessing() {
    if (processTimeout) {
      return;
    }
    processTimeout = setTimeout(() => {
      processTimeout = null;
      runAutoProcessing();
    }, PROCESS_DELAY_MS);
  }

  function initializeObservers() {
    mutationObserver = new MutationObserver((records) => {
      if (fullScanPending) {
        scheduleProcessing();
        return;
      }
      for (const record of records) {
        if (record.type === "characterData") {
          dirtyRoots.add(record.target.parentElement);
        } else {
          for (const added of record.addedNodes) {
            dirtyRoots.add(added.nodeType === Node.TEXT_NODE ? added.parentElement : added);
          }
        }
      }
      dirtyRoots.delete(null);
      if (dirtyRoots.size > 0) {
        if (dirtyRoots.size > MAX_DIRTY_ROOTS) {
          fullScanPending = true;
          dirtyRoots.clear();
        }
        scheduleProcessing();
      }
    });
    observeMutations();
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.action) {
      case "reprocess":
        (async () => {
          await processingQueue;
          resetProcessedState();
          cleanupCache();
          sendResponse(await runCurrencyConversion());
        })().catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      case "clearCache":
        (async () => {
          await processingQueue;
          rateCache.clear();
          resetProcessedState();
          sendResponse({ ok: true });
        })().catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      default:
        return false;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

    if (changes.currency || changes.compactMode) {
      resetProcessedState();
      runAutoProcessing();
    } else if (changes.autoProcess?.newValue === true) {
      fullScanPending = true;
      runAutoProcessing();
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

  const initialRun = () => {
    if (!document.body) {
      return;
    }

    initializeObservers();

    runAutoProcessing();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialRun, { once: true });
  } else {
    initialRun();
  }
})();
