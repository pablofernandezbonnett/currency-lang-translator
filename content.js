(async () => {
  // In content.js - add CSP compliance
  function createSecureElement(tag, attributes = {}) {
    const element = document.createElement(tag);

    // Only set safe attributes
    const safeAttributes = ["id", "class", "style", "title", "data-"];

    for (const [key, value] of Object.entries(attributes)) {
      if (safeAttributes.some((safe) => key.startsWith(safe))) {
        element.setAttribute(key, value);
      }
    }

    return element;
  }

  // Enhanced security function
  function initializeSecurity() {
    if (window.currencyTranslatorInjected) {
      return false;
    }
    window.currencyTranslatorInjected = true;

    // Enhanced protocol validation
    const allowedProtocols = ["http:", "https:"];
    if (!allowedProtocols.includes(window.location.protocol)) {
      return false;
    }

    // Block dangerous domains
    const blockedDomains = [
      "chrome-extension:",
      "moz-extension:",
      "about:",
      "javascript:",
    ];
    if (
      blockedDomains.some((domain) => window.location.href.includes(domain))
    ) {
      return false;
    }

    return true;
  }

  // Enhanced input sanitization
  function sanitizeInput(text) {
    if (!text || typeof text !== "string") return "";

    return text
      .replace(/[<>]/g, "")
      .replace(/javascript:/gi, "")
      .replace(/data:/gi, "")
      .replace(/vbscript:/gi, "")
      .replace(/on\w+=/gi, "")
      .substring(0, 1000);
  }

  // Fix async/await in getExchangeRate
  async function getExchangeRates(fromCurrencies, toCurrency) {
    if (!fromCurrencies || fromCurrencies.length === 0) return {};

    const rates = {};
    const currenciesToFetch = [];

    // Check cache first
    for (const from of fromCurrencies) {
      if (from === toCurrency) {
        rates[from] = 1;
        continue;
      }
      const cacheKey = `${from}_${toCurrency}`;
      const cached = rateCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        rates[from] = cached.rate;
      } else {
        currenciesToFetch.push(from);
      }
    }

    if (currenciesToFetch.length === 0) {
      return rates;
    }

    console.log(
      `[API] Requesting rates from background for ${currenciesToFetch.join(
        ","
      )} -> ${toCurrency}`
    );

    const response = await chrome.runtime.sendMessage({
      action: "getRates",
      payload: { fromCurrencies: currenciesToFetch, toCurrency },
    });

    if (response.error) {
      console.warn(
        `Failed to get rates for ${currenciesToFetch.join(
          ","
        )} -> ${toCurrency}:`,
        response.error
      );
      return rates; // Return what we have from cache
    }

    if (response.rates) {
      for (const [from, rate] of Object.entries(response.rates)) {
        rateCache.set(`${from}_${toCurrency}`, { rate, timestamp: Date.now() });
        rates[from] = rate;
      }
    }

    return rates;
  }

  // Call at the beginning of content.js:
  if (!initializeSecurity()) {
    return;
  }

  // Prevent multiple executions
  if (window.currencyTranslatorProcessed) {
    return;
  }
  window.currencyTranslatorProcessed = true;

  let isProcessing = false;
  let intersectionObserver = null;

  // Processing statistics
  let stats = {
    conversions: 0,
    translations: 0,
  };

  // Cache for translations and exchange rates
  const translationCache = new Map();
  const rateCache = new Map();
  const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Add cleanup function after getUserCurrencySymbol() function around line 180
  // Refactor: Simplify cache cleanup and improve readability
  function cleanupCache() {
    const now = Date.now();
    let cleanedTranslations = 0;
    let cleanedRates = 0;

    // Clear translation cache
    for (const [key, value] of translationCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        translationCache.delete(key);
        cleanedTranslations++;
      }
    }

    // Clear rate cache
    for (const [key, value] of rateCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        rateCache.delete(key);
        cleanedRates++;
      }
    }

    // Clear processed texts if the set is too large
    if (processedTexts.size > 2000) {
      processedTexts.clear();
    }

    console.log(
      `Cache cleanup: ${cleanedTranslations} translations, ${cleanedRates} rates removed`
    );
  }

  // Refactor: Initialize cleanup on a single timer
  function initializeCleanup() {
    // Execute cleanup every 5 minutes
    setInterval(cleanupCache, CLEANUP_INTERVAL);

    // Clear on page change
    window.addEventListener("beforeunload", () => {
      cleanupCache();
      // Send a message to background.js to cancel ongoing translations for this tab
      chrome.runtime.sendMessage({ action: "cancelTranslation" }).catch(() => {});
    });
  }

  // Add to the end of the file, before initial execution
  initializeCleanup();

  // Also add manual cleanup in the message listener
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
      case "reprocess":
        processedElements = new WeakMap();
        processedTexts.clear();
        cleanupCache(); // Add this
        runTranslationAndConversion();
        break;
      case "clearCache":
        translationCache.clear();
        rateCache.clear();
        processedElements = new WeakMap();
        processedTexts.clear();
        cleanupCache();
        chrome.runtime.sendMessage({ action: "done" }).catch(() => {});
        break;
      case "deepCleanup":
        cleanupCache();
        break;
    }
  });

  // Load saved statistics
  async function loadStats() {
    try {
      const result = await chrome.storage.sync.get(["stats"]);
      if (result.stats) {
        stats = { ...stats, ...result.stats };
      }
    } catch (error) {
      console.warn("Error loading stats:", error);
    }
  }

  // Save statistics
  async function saveStats() {
    try {
      await chrome.storage.sync.set({ stats });
      // Notify popup about the update
      chrome.runtime
        .sendMessage({
          action: "updateStats",
          stats: stats,
        })
        .catch(() => {});
    } catch (error) {
      console.warn("Error saving stats:", error);
    }
  }

  // Get exchange rates for multiple currencies
  async function getExchangeRates(userCurrency) {
    const symbolsToFind = ["JPY", "USD", "GBP", "EUR", "CNY", "KRW"];
    const foundSymbols = new Set();

    // 1. Detect which currency symbols are on the page
    const textContent = document.body.innerText || "";
    for (const symbol of symbolsToFind) {
      if (textContent.includes(symbol)) {
        foundSymbols.add(symbol);
      }
    }

    // Do nothing if no symbols are found or only the user's currency is found
    if (
      foundSymbols.size === 0 ||
      (foundSymbols.size === 1 && foundSymbols.has(userCurrency))
    ) {
      return {};
    }

    // 2. Request only necessary exchange rates
    const symbolsToRequest = Array.from(foundSymbols).filter(
      (s) => s !== userCurrency
    );
    if (symbolsToRequest.length === 0) {
      return {};
    }

    const rates = {};
    const promises = symbolsToRequest.map(async (symbol) => {
      const rate = await getExchangeRate(symbol, userCurrency);
      if (rate) {
        rates[symbol] = rate;
      }
    });

    await Promise.all(promises);
    return rates;
  }

  // Translate text with fallback
  async function translateText(text, targetLang = "en") {
    if (!text || text.length < 2) return text;

    // Sanitize input
    text = sanitizeInput(text);

    // After sanitizing, check if there's any text left to translate to prevent 400 errors
    if (!text || text.trim().length < 2) return text;

    const cacheKey = `${text}_${targetLang}`;
    const cached = translationCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.translation;
    }

    // Limit text length
    if (text.length > 500) {
      text = text.substring(0, 500) + "...";
    }

    console.log(`[API] Attempting to translate text to ${targetLang}`);

    try {
      const response = await chrome.runtime.sendMessage({
        action: "translate",
        payload: { text, targetLang },
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const translation = response.translation;
      if (translation && translation !== text) {
        translationCache.set(cacheKey, {
          translation,
          timestamp: Date.now(),
        });

        stats.translations++;
        saveStats();
        return translation;
      }
    } catch (error) {
      console.warn("Translation request failed:", error.message);
    }

    return text; // Return original text on any failure
  }

  // Convert currencies in text
  function convertCurrencies(text, rates, userCurrency) {
    // More robust currency patterns
    // Improve currency regex patterns in convertCurrencies function:
    const currencyPatterns = {
      JPY: {
        regex:
          /(?:¥|JPY\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)|([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)\s*円/gi,
        symbol: "¥",
        rateKey: "JPY",
      },
      USD: {
        regex:
          /(?:\$|USD\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
        symbol: "$",
      },
      EUR: {
        regex: /(?:€|EUR\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
        symbol: "€",
      },
      GBP: {
        regex: /(?:£|GBP\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
        symbol: "£",
      },
      CNY: {
        regex:
          /(?:¥|CNY\s*|RMB\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
        symbol: "¥",
      },
      KRW: {
        regex: /(?:₩|KRW\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*)/gi,
        symbol: "₩",
      },
    };

    let convertedText = text;
    let conversionsFound = 0;

    for (const [currency, pattern] of Object.entries(currencyPatterns)) {
      if (rates[currency] && currency !== userCurrency) {
        convertedText = convertedText.replace(
          pattern.regex,
          (match, num1, num2) => {
            try {
              const num = num1 || num2;
              const value = parseFloat(num.replace(/,/g, ""));
              if (isNaN(value) || value <= 0) return match;

              const converted = (value * rates[currency]).toFixed(2);
              const userSymbol = getUserCurrencySymbol(userCurrency); // Consider pre-fetching this
              conversionsFound++;
              return `${match} (≈ ${userSymbol}${converted})`;
            } catch (error) {
              console.warn("Error converting currency:", error);
              return match;
            }
          }
        );
      }
    }

    // Update statistics if conversions were found
    if (conversionsFound > 0) {
      stats.conversions += conversionsFound;
      saveStats();
    }

    return convertedText;
  }

  // Get user currency symbol
  function getUserCurrencySymbol(currency) {
    const symbols = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      CNY: "¥",
      KRW: "₩",
    };
    return symbols[currency] || currency + " ";
  }

  // Refactor: Improve language detection using a more robust library or API
  function detectLanguage(text) {
    const patterns = {
      japanese: {
        regex: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g,
        confidence: 0.3,
      },
      korean: { regex: /[\uAC00-\uD7AF]/g, confidence: 0.3 },
      chinese: { regex: /[\u4E00-\u9FFF]/g, confidence: 0.3 },
      arabic: { regex: /[\u0600-\u06FF]/g, confidence: 0.3 },
      russian: { regex: /[\u0400-\u04FF]/g, confidence: 0.3 },
      thai: { regex: /[\u0E00-\u0E7F]/g, confidence: 0.3 },
      hebrew: { regex: /[\u0590-\u05FF]/g, confidence: 0.3 },
    };

    const textLength = text.length;
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = text.match(pattern.regex);
      if (matches && matches.length / textLength > pattern.confidence) {
        return lang;
      }
    }

    return "unknown";
  }

  // Refactor: simplify needsTranslation logic
  function needsTranslation(text, targetLang) {
    const detectedLang = detectLanguage(text);

    // Map detected languages to language codes
    const langMap = {
      japanese: "ja",
      korean: "ko",
      chinese: "zh",
      arabic: "ar",
      russian: "ru",
      thai: "th",
      hebrew: "he",
    };

    // If the detected language is the same as the target, do not translate
    if (langMap[detectedLang] === targetLang) return false;

    // Only translate if it contains non-Latin characters and the text is long enough
    return detectedLang !== "unknown" && text.trim().length > 3;
  }

  function detectCurrenciesOnPage() {
    const symbolsToFind = ["JPY", "USD", "GBP", "EUR", "CNY", "KRW"];
    const foundSymbols = new Set();
    const textContent = document.body.innerText || "";

    for (const symbol of symbolsToFind) {
      if (textContent.includes(symbol)) {
        foundSymbols.add(symbol);
      }
    }
    return Array.from(foundSymbols);
  }

  async function translateTextNodesInBatches(textNodesToTranslate, targetLang) {
    const BATCH_SIZE = 20; // Number of text nodes to group per request
    const TEXT_SEPARATOR = " "; // Unique separator

    for (let i = 0; i < textNodesToTranslate.length; i += BATCH_SIZE) {
      const batch = textNodesToTranslate.slice(i, i + BATCH_SIZE);
      const textsToTranslate = batch.map((item) => item.originalText);

      if (textsToTranslate.length === 0) continue;

      const combinedText = textsToTranslate.join(TEXT_SEPARATOR);
      const cacheKey = `${combinedText}_${targetLang}`;
      const cached = translationCache.get(cacheKey);

      let translatedCombinedText = "";
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        translatedCombinedText = cached.translation;
      } else {
        console.log(
          `[API] Attempting to translate batch of texts to ${targetLang}`
        );
        try {
          const response = await chrome.runtime.sendMessage({
            action: "translate", // Return to 'translate' action
            payload: { text: combinedText, targetLang },
          });

          if (response.error) {
            throw new Error(response.error);
          }
          translatedCombinedText = response.translation;
          translationCache.set(cacheKey, {
            translation: translatedCombinedText,
            timestamp: Date.now(),
          });
          stats.translations += textsToTranslate.length;
          saveStats();
        } catch (error) {
          console.warn("Translation batch request failed:", error.message);
          // If it fails, use the combined original texts
          translatedCombinedText = combinedText;
        }
      }

      // Split the combined translation and update the nodes
      const translatedTexts = translatedCombinedText.split(TEXT_SEPARATOR);

      batch.forEach((item, index) => {
        const translated = translatedTexts[index];
        if (translated && translated !== item.originalText) {
          item.node.nodeValue = item.hasChanges
            ? `${item.processedText} | ${translated}`
            : `${item.processedText} (${translated})`;
          if (item.node.parentNode) {
            processedElements.set(item.node.parentNode, true);
          }
          processedTexts.add(item.originalText.substring(0, 100));
        } else if (item.hasChanges) {
          // If there was no translation but there were currency changes, apply those changes
          item.node.nodeValue = item.processedText;
          if (item.node.parentNode) {
            processedElements.set(item.node.parentNode, true);
          }
          processedTexts.add(item.originalText.substring(0, 100));
        }
      });
    }
  }

  // Process text node
  let processedElements = new WeakMap();
  const processedTexts = new Set();

  function processTextNode(node, rates, userCurrency, targetLang) {
    // Check if this parent element has already been processed
    if (processedElements.has(node.parentNode)) return null;

    // Check if this specific text has already been processed
    const originalText = node.nodeValue.trim();
    if (!originalText || originalText.length < 2) return null;

    const textHash = originalText.substring(0, 100); // Use first 100 chars as hash
    if (processedTexts.has(textHash)) return null;

    let processedText = originalText;
    let hasChanges = false;

    // Currency conversion
    if (Object.keys(rates).length > 0) {
      const convertedText = convertCurrencies(
        processedText,
        rates,
        userCurrency
      );
      if (convertedText !== processedText) {
        processedText = convertedText;
        hasChanges = true;
      }
    }

    // Return information for further processing
    return {
      node,
      originalText,
      processedText,
      hasChanges,
      needsTranslation: needsTranslation(originalText, targetLang),
    };
  }

  // Process DOM
  async function processDOM(node, rates, userCurrency, targetLang) {
    if (!node) return;

    const nodesForTranslation = [];

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName;
        if (
          ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG"].includes(tagName)
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let currentNode;
    const textNodes = [];
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode);
    }

    // First pass: Currency conversion and collection of nodes for translation
    for (const textNode of textNodes) {
      const result = processTextNode(textNode, rates, userCurrency, targetLang);
      if (result) {
        if (result.needsTranslation) {
          nodesForTranslation.push(result);
        } else if (result.hasChanges) {
          // If there are only currency changes, apply immediately
          textNode.nodeValue = result.processedText;
          processedElements.set(result.node.parentNode, true);
          processedTexts.add(result.originalText.substring(0, 100));
        }
      }
    }

    // Second pass: Process translations in batches
    if (nodesForTranslation.length > 0) {
      await translateTextNodesInBatches(nodesForTranslation, targetLang);
    }
  }

  // Main application logic
  let processingQueue = Promise.resolve();

  async function runTranslationAndConversion() {
    if (isProcessing) return;

    // Queue processing to prevent race conditions
    processingQueue = processingQueue.then(async () => {
      isProcessing = true;

      try {
        chrome.runtime
          .sendMessage({
            action: "progress",
            message: "Loading settings...",
          })
          .catch(() => {});

        // Load saved statistics
        await loadStats();

        // Get settings
        const { currency, language, autoProcess } =
          await chrome.storage.sync.get([
            "currency",
            "language",
            "autoProcess",
          ]);

        const userCurrency = currency || "EUR";
        const targetLang = language || "en";

        chrome.runtime
          .sendMessage({
            action: "progress",
            message: "Fetching exchange rates...",
          })
          .catch(() => {});

        // Get exchange rates
        const symbolsOnPage = detectCurrenciesOnPage();
        const rates = await getExchangeRates(symbolsOnPage, userCurrency);
        // Refactor:  Consider caching the userCurrency symbol for efficiency
        chrome.runtime
          .sendMessage({
            action: "progress",
            message: "Processing content... (visible elements)",
          })
          .catch(() => {});

        // Initialize IntersectionObserver for visible elements
        if (intersectionObserver) {
          intersectionObserver.disconnect();
        }
        intersectionObserver = new IntersectionObserver(
          (entries) => {
            entries.forEach(async (entry) => {
              if (entry.isIntersecting) {
                // Process only visible text nodes within the intersecting element
                await processDOM(entry.target, rates, userCurrency, targetLang);
                intersectionObserver.unobserve(entry.target); // Stop observing once processed
              }
            });
          },
          { root: null, threshold: 0.1 } // Observe when 10% of element is visible
        );

        // Observe all text nodes for visibility
        const allTextNodes = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function (node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tagName = parent.tagName;
            if (
              ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG"].includes(tagName)
            ) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        let node;
        while ((node = walker.nextNode())) {
          allTextNodes.push(node);
        }

        allTextNodes.forEach((textNode) => {
          if (textNode.parentNode) { // Ensure parentNode exists before observing
            intersectionObserver.observe(textNode.parentNode);
          }
        });


        // Notify that it finished
        chrome.runtime.sendMessage({ action: "done" }).catch(() => {});
      } catch (error) {
        console.error("Error in runTranslationAndConversion:", error);
        chrome.runtime
          .sendMessage({
            action: "error",
            error: error.message,
          })
          .catch(() => {});
      } finally {
        isProcessing = false;
      }
    });
    return processingQueue;
  }

  // Enhanced debouncing for DOM mutations
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  const debouncedProcessing = debounce(() => {
    if (!isProcessing) {
      chrome.storage.sync.get(["autoProcess"], ({ autoProcess }) => {
        if (autoProcess !== false) {
          runTranslationAndConversion();
        }
      });
    }
  }, 1000);

  // Observe DOM changes for dynamically loaded content
  const mutationObserver = new MutationObserver(debouncedProcessing);

  // Start observing the document body for changes.
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Handle uncaught errors
  window.addEventListener("error", (event) => {
    console.error("Content script error:", event.error);
  });

  // Execute on load
  const initialRun = () => {
    chrome.storage.sync.get(["autoProcess"], ({ autoProcess }) => {
      // Default to true if the setting is not present
      if (autoProcess !== false) {
        runTranslationAndConversion();
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialRun);
  } else {
    initialRun();
  }

  function cleanup() {
    cleanupCache();
  }

  // Refactor: Use a more subtle or configurable feedback mechanism
  function showUserFeedback(message, type = "info") {
    const feedback = document.createElement("div");
    feedback.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background: ${type === "error" ? "#f44336" : "#4caf50"};
    color: white;
    padding: 10px 15px;
    border-radius: 5px;
    z-index: 10000;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    `;
    feedback.textContent = message;
    document.body.appendChild(feedback);

    setTimeout(() => {
      feedback.remove();
    }, 3000);
  }

  // Refactor: Consolidate error handling and provide more context-specific information
  function handleError(error, context) {
    console.error(`Error in ${context}:`, error);

    // Don't overwhelm with error messages
    if (Date.now() - lastErrorTime > 5000) {
      // Refactor: Consider using a more robust error reporting mechanism
      chrome.runtime
        .sendMessage({
          action: "error",
          error: `${context}: ${error.message}`,
        })
        .catch(() => {});
      lastErrorTime = Date.now();
    }
  }

  let lastErrorTime = 0;
})();