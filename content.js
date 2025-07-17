// Move RateLimiter class to the top
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
  if (blockedDomains.some((domain) => window.location.href.includes(domain))) {
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
async function getExchangeRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;

  if (!apiRateLimiter.canMakeRequest()) {
    console.warn("Rate limit exceeded, using cached rates");
    return null;
  }

  const cacheKey = `${fromCurrency}_${toCurrency}`;
  const cached = rateCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.rate;
  }

  const errors = [];

  for (const api of CURRENCY_APIS) {
    try {
      if (!apiRateLimiter.makeRequest()) {
        continue;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(api.url(fromCurrency, toCurrency), {
        signal: controller.signal,
        headers: {
          "User-Agent": "Currency Translator Extension",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        errors.push(`${api.name}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const rate = api.parseResponse(data, toCurrency);

      if (rate && rate > 0 && isFinite(rate)) {
        rateCache.set(cacheKey, { rate, timestamp: Date.now() });
        return rate;
      }

      errors.push(`${api.name}: Invalid rate received`);
    } catch (error) {
      errors.push(`${api.name}: ${error.message}`);
      continue;
    }
  }

  console.warn(`All APIs failed for ${fromCurrency} to ${toCurrency}:`, errors);
  return null;
}

// Call at the beginning of content.js:
if (!initializeSecurity()) {
  return;
}

// Evitar múltiples ejecuciones
if (window.currencyTranslatorProcessed) {
  return;
}
window.currencyTranslatorProcessed = true;

let isProcessing = false;

// Estadísticas de procesamiento
let stats = {
  conversions: 0,
  translations: 0,
};

// Cache para traducciones y tasas de cambio
const translationCache = new Map();
const rateCache = new Map();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutos

// Añadir función de limpieza después de la función getUserCurrencySymbol() alrededor de la línea 180
// Refactor: Simplify cache cleanup and improve readability
function cleanupCache() {
  const now = Date.now();
  let cleanedTranslations = 0;
  let cleanedRates = 0;

  // Limpiar cache de traducciones
  for (const [key, value] of translationCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      translationCache.delete(key);
      cleanedTranslations++;
    }
  }

  // Limpiar cache de tasas
  for (const [key, value] of rateCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      rateCache.delete(key);
      cleanedRates++;
    }
  }

  // Limpiar textos procesados si el conjunto es muy grande
  if (processedTexts.size > 2000) {
    processedTexts.clear();
  }

  console.log(
    `Cache cleanup: ${cleanedTranslations} translations, ${cleanedRates} rates removed`
  );
}

// Refactor: Initialize cleanup on a single timer
// Añadir después de la función cleanupCache()
function initializeCleanup() {
  // Ejecutar limpieza cada 5 minutos
  setInterval(cleanupCache, CLEANUP_INTERVAL);

  // Limpiar al cambiar de página
  window.addEventListener("beforeunload", () => {
    cleanupCache();
  });
}

// Añadir al final del archivo, antes de la ejecución inicial
initializeCleanup();

// También añadir limpieza manual en el listener de mensajes
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "reprocess":
      processedElements.clear();
      processedTexts.clear();
      cleanupCache(); // Add this
      runTranslationAndConversion();
      break;
    case "clearCache":
      translationCache.clear();
      rateCache.clear();
      processedElements.clear();
      processedTexts.clear();
      cleanupCache();
      chrome.runtime.sendMessage({ action: "done" }).catch(() => {});
      break;
    case "deepCleanup":
      cleanupCache();
      break;
  }
}); // In content.js, within the main logic:

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(async (entry) => {
      if (entry.isIntersecting) {
        // Process only the visible element
        await processDOM(entry.target, rates, userCurrency, targetLang);
        // Optionally, unobserve the element after processing
        // observer.unobserve(entry.target);
      }
    });
  },
  {
    root: null, // Use the viewport as the root
    threshold: 0.1, // Trigger when 10% of the element is visible
  }
);

// Instead of processing the entire document.body:
// observer.observe(document.body);

// Observe specific sections or elements:
// document.querySelectorAll(".price-container").forEach(el => observer.observe(el));
// In runTranslationAndConversion or within a modified processDOM:

async function runTranslationAndConversion() {
  // ... existing code ...
  // Refactor: Use more specific selectors for better performance.  Consider making these configurable.
  const targetElements = document.querySelectorAll(
    "p, span, div.price, h1, h2, h3"
  ); // Example selectors
  for (const element of targetElements) {
    await processDOM(element, rates, userCurrency, targetLang);
  }

  // ... rest of the code ...
}
// In content.js:

// ... inside runTranslationAndConversion() ...
const textNodes = []; // Collect text nodes
// ... inside the TreeWalker loop ...
textNodes.push(currentNode.nodeValue);
// ... After the TreeWalker loop ...
if (textNodes.length > 0) {
  // const translatedTexts = await batchTranslate(textNodes, targetLang);  // Commented out as batchTranslate is not fully implemented
  // Apply translations back to nodes, maintaining order.
  // ...  requires logic to map translations back to original nodes
}
// ...

async function batchTranslate(texts, targetLang) {
  // ... Function to send all texts in one API request and return an array of translations.
  // TODO: Implement batch translation logic for efficiency
  //     Will need to handle API-specific formatting of batched requests.
}

// APIs de conversión de divisas (fallback)
const CURRENCY_APIS = [
  {
    name: "fawazahmed0",
    url: (base, target) =>
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`,
    parseResponse: (data, target) => data[target.toLowerCase()] || null,
  },
  {
    name: "exchangerate-api",
    url: (base, target) =>
      `https://api.exchangerate-api.com/v4/latest/${base.toUpperCase()}`,
    parseResponse: (data, target) => data.rates?.[target.toUpperCase()] || null,
  },
  {
    name: "exchangerate.host",
    url: (base, target) =>
      `https://api.exchangerate.host/latest?base=${base.toUpperCase()}&symbols=${target.toUpperCase()}`,
    parseResponse: (data, target) => data.rates?.[target.toUpperCase()] || null,
  },
];

// APIs de traducción (fallback)
const TRANSLATION_APIS = [
  {
    name: "libretranslate",
    url: "https://libretranslate.de/translate",
    translate: async (text, targetLang) => {
      const response = await fetch("https://libretranslate.de/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: text,
          source: "auto",
          target: targetLang,
          format: "text",
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.translatedText;
    },
  },
  {
    name: "mymemory",
    url: "https://api.mymemory.translated.net/get",
    translate: async (text, targetLang) => {
      const response = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
          text
        )}&langpair=auto|${targetLang}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.responseData?.translatedText || text;
    },
  },
  {
    name: "google-translate-free",
    url: "https://translate.googleapis.com/translate_a/single",
    translate: async (text, targetLang) => {
      const response = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(
          text
        )}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data[0]?.[0]?.[0] || text;
    },
  },
];

// Cargar estadísticas guardadas
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

// Guardar estadísticas
async function saveStats() {
  try {
    await chrome.storage.sync.set({ stats });
    // Notificar al popup sobre la actualización
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

// Obtener tasas de cambio para múltiples divisas
async function getExchangeRates(userCurrency) {
  const symbols = ["JPY", "USD", "GBP", "EUR", "CNY", "KRW"];
  const rates = {};

  const promises = symbols.map(async (symbol) => {
    if (symbol === userCurrency) {
      rates[symbol] = 1;
      return;
    }

    const rate = await getExchangeRate(symbol, userCurrency);
    if (rate) {
      rates[symbol] = rate;
    }
  });

  await Promise.all(promises);
  return rates;
}

// Traducir texto con fallback
async function translateText(text, targetLang = "en") {
  if (!text || text.length < 2) return text;

  // Sanitize input
  text = sanitizeInput(text);

  const cacheKey = `${text}_${targetLang}`;
  const cached = translationCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.translation;
  }

  // Limitar longitud del texto
  if (text.length > 500) {
    text = text.substring(0, 500) + "...";
  }

  for (const api of TRANSLATION_APIS) {
    try {
      const translation = await api.translate(text, targetLang);

      if (translation && translation !== text) {
        translationCache.set(cacheKey, {
          translation,
          timestamp: Date.now(),
        });

        // Incrementar contador de traducciones
        stats.translations++;
        saveStats();

        return translation;
      }
    } catch (error) {
      console.warn(`Error with ${api.name}:`, error);
      continue;
    }
  }

  console.warn("All translation APIs failed");
  return text;
}

// Convertir divisas en texto
function convertCurrencies(text, rates, userCurrency) {
  // Patrones de moneda más robustos
  // Improve currency regex patterns in convertCurrencies function:
  const currencyPatterns = {
    JPY: {
      regex: /(?:¥|JPY\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
      symbol: "¥",
      rateKey: "JPY",
    },
    USD: {
      regex: /(?:\$|USD\s*)([0-9]{1,3}(?:[,\s]?[0-9]{3})*(?:\.[0-9]{1,2})?)/gi,
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
      convertedText = convertedText.replace(pattern.regex, (match, num) => {
        try {
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
      });
    }
  }

  // Actualizar estadísticas si se encontraron conversiones
  if (conversionsFound > 0) {
    stats.conversions += conversionsFound;
    saveStats();
  }

  return convertedText;
}

// Obtener símbolo de divisa del usuario
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
// Detectar si el texto necesita traducción
function detectLanguage(text) {
  const patterns = {
    japanese: {
      regex: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/,
      confidence: 0.3,
    },
    korean: { regex: /[\uAC00-\uD7AF]/, confidence: 0.3 },
    chinese: { regex: /[\u4E00-\u9FFF]/, confidence: 0.3 },
    arabic: { regex: /[\u0600-\u06FF]/, confidence: 0.3 },
    russian: { regex: /[\u0400-\u04FF]/, confidence: 0.3 },
    thai: { regex: /[\u0E00-\u0E7F]/, confidence: 0.3 },
    hebrew: { regex: /[\u0590-\u05FF]/, confidence: 0.3 },
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

  // Mapear idiomas detectados a códigos de idioma
  const langMap = {
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    arabic: "ar",
    russian: "ru",
    thai: "th",
    hebrew: "he",
  };

  // Si el idioma detectado es el mismo que el objetivo, no traducir
  if (langMap[detectedLang] === targetLang) return false;

  // Solo traducir si contiene caracteres no latinos y el texto es suficientemente largo
  return detectedLang !== "unknown" && text.trim().length > 3;
}

// Procesar nodo de texto
const processedElements = new WeakMap();
const processedTexts = new Set();

async function processTextNode(node, rates, userCurrency, targetLang) {
  // Verificar si ya se procesó este elemento padre
  if (processedElements.has(node.parentNode)) return;

  // Verificar si ya se procesó este texto específico
  const originalText = node.nodeValue.trim();
  if (!originalText || originalText.length < 2) return;

  const textHash = originalText.substring(0, 100); // Usar primeros 100 chars como hash
  if (processedTexts.has(textHash)) return;

  let processedText = originalText;
  let hasChanges = false;

  // Conversión de divisas
  if (Object.keys(rates).length > 0) {
    const convertedText = convertCurrencies(processedText, rates, userCurrency);
    if (convertedText !== processedText) {
      processedText = convertedText;
      hasChanges = true;
    }
  }

  // Traducción si es necesario
  if (needsTranslation(originalText, targetLang)) {
    try {
      const translated = await translateText(originalText, targetLang);
      if (translated !== originalText) {
        processedText = hasChanges
          ? `${processedText} | ${translated}`
          : `${processedText} (${translated})`;
        hasChanges = true;
      }
    } catch (error) {
      console.warn("Translation error:", error);
    }
  }

  if (hasChanges) {
    node.nodeValue = processedText;
    processedElements.set(node.parentNode, true);
    processedTexts.add(textHash);
  }
}

// Procesar DOM
async function processDOM(node, rates, userCurrency, targetLang) {
  // Refactor: Use more specific selectors or allow user-defined selectors
  if (!node) return;

  // Use TreeWalker for better performance
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      // Skip script, style, and other non-content nodes
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const tagName = parent.tagName;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG"].includes(tagName)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  let currentNode;

  while ((currentNode = walker.nextNode())) {
    textNodes.push(currentNode);
  }

  // Process in batches to prevent blocking
  const batchSize = 10;
  for (let i = 0; i < textNodes.length; i += batchSize) {
    const batch = textNodes.slice(i, i + batchSize);

    await Promise.all(
      batch.map((node) =>
        processTextNode(node, rates, userCurrency, targetLang)
      )
    );
    // Refactor: Consider using requestAnimationFrame instead of setTimeout(0)

    // Allow other tasks to run
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// main app
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

      // Cargar estadísticas
      await loadStats();

      // Obtener configuraciones
      const { currency, language, autoProcess } = await chrome.storage.sync.get(
        ["currency", "language", "autoProcess"]
      );

      const userCurrency = currency || "EUR";
      const targetLang = language || "en";

      chrome.runtime
        .sendMessage({
          action: "progress",
          message: "Fetching exchange rates...",
        })
        .catch(() => {});

      // Obtener tasas de cambio
      const rates = await getExchangeRates(userCurrency);
      // Refactor:  Consider caching the userCurrency symbol for efficiency
      chrome.runtime
        .sendMessage({
          action: "progress",
          message: "Processing content...",
        })
        .catch(() => {});

      // Procesar el DOM
      await processDOM(document, rates, userCurrency, targetLang);

      // Notificar que terminó
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

// Refactor: Observe a more specific container instead of document.body, or use IntersectionObserver more effectively.
observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Manejar errores no capturados
window.addEventListener("error", (event) => {
  console.error("Content script error:", event.error);
});

// Ejecutar al cargar
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runTranslationAndConversion);
} else {
  runTranslationAndConversion();
}

function cleanup() {
  cleanupCache();
}

// Refactor: Use a more subtle or configurable feedback mechanism
// Add to content.js:
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
