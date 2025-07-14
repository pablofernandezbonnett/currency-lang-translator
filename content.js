// Evitar múltiples ejecuciones
if (window.currencyTranslatorProcessed) {
  return;
}
window.currencyTranslatorProcessed = true;

let isProcessing = false;
let processedNodes = new WeakSet();

// Cache para traducciones y tasas de cambio
const translationCache = new Map();
const rateCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

async function getExchangeRates(userCurrency) {
  const cacheKey = `rates_${userCurrency}`;
  const cached = rateCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.rates;
  }

  const symbols = ["JPY", "USD", "GBP", "EUR"];
  const rates = {};

  try {
    const rateResponses = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(
            `https://api.exchangerate.host/latest?base=${symbol}&symbols=${userCurrency}`,
            { signal: AbortSignal.timeout(5000) }
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        } catch (error) {
          console.warn(`Error fetching rate for ${symbol}:`, error);
          return null;
        }
      })
    );

    rateResponses.forEach((response, index) => {
      if (response && response.rates && response.rates[userCurrency]) {
        rates[symbols[index]] = response.rates[userCurrency];
      }
    });

    // Cache los resultados
    rateCache.set(cacheKey, {
      rates,
      timestamp: Date.now(),
    });

    return rates;
  } catch (error) {
    console.error("Error fetching exchange rates:", error);
    return {};
  }
}

async function translateText(text, targetLang = "en") {
  const cacheKey = `${text}_${targetLang}`;
  const cached = translationCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.translation;
  }

  // Limitar longitud del texto
  if (text.length > 500) {
    text = text.substring(0, 500) + "...";
  }

  try {
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
    const translation = data.translatedText || text;

    // Cache la traducción
    translationCache.set(cacheKey, {
      translation,
      timestamp: Date.now(),
    });

    return translation;
  } catch (error) {
    console.warn("Translation failed:", error);
    return text; // Devolver texto original si falla
  }
}

function convertCurrencies(text, rates, userCurrency) {
  const regexMap = {
    JPY: /(?:¥|JPY\s?)(\d+(?:[,.]\d{1,3})?)/gi,
    USD: /(?:\$|USD\s?)(\d+(?:[,.]\d{1,2})?)/gi,
    GBP: /(?:£|GBP\s?)(\d+(?:[,.]\d{1,2})?)/gi,
    EUR: /(?:€|EUR\s?)(\d+(?:[,.]\d{1,2})?)/gi,
  };

  let convertedText = text;

  for (const [currency, regex] of Object.entries(regexMap)) {
    if (rates[currency]) {
      convertedText = convertedText.replace(regex, (match, num) => {
        try {
          const value = parseFloat(num.replace(/,/g, ""));
          if (isNaN(value) || value <= 0) return match;

          const converted = (value * rates[currency]).toFixed(2);
          return `${match} (≈ ${converted} ${userCurrency})`;
        } catch (error) {
          console.warn("Error converting currency:", error);
          return match;
        }
      });
    }
  }

  return convertedText;
}

async function processTextNode(node, rates, userCurrency, targetLang) {
  if (processedNodes.has(node)) return;

  const originalText = node.nodeValue.trim();
  if (!originalText) return;

  let processedText = originalText;

  // Conversión de monedas
  if (Object.keys(rates).length > 0) {
    processedText = convertCurrencies(processedText, rates, userCurrency);
  }

  // Traducción si contiene caracteres japoneses
  if (
    /[\u3040-\u30FF\u4E00-\u9FFF]/.test(processedText) &&
    targetLang !== "ja"
  ) {
    try {
      const translated = await translateText(originalText, targetLang);
      if (translated !== originalText) {
        processedText = `${processedText} (${translated})`;
      }
    } catch (error) {
      console.warn("Translation error:", error);
    }
  }

  if (processedText !== originalText) {
    node.nodeValue = processedText;
    processedNodes.add(node);
  }
}

async function processDOM(node, rates, userCurrency, targetLang) {
  if (!node) return;

  if (node.nodeType === 3) {
    // Text node
    await processTextNode(node, rates, userCurrency, targetLang);
  } else if (
    node.nodeType === 1 &&
    node.childNodes &&
    !["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG"].includes(node.tagName)
  ) {
    // Procesar nodos hijo
    const childNodes = Array.from(node.childNodes);
    for (const child of childNodes) {
      await processDOM(child, rates, userCurrency, targetLang);
    }
  }
}

async function runTranslationAndConversion() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    // Obtener configuraciones
    const { currency, language } = await chrome.storage.sync.get([
      "currency",
      "language",
    ]);

    const userCurrency = currency || "EUR";
    const targetLang = language || "en";

    // Obtener tasas de cambio
    const rates = await getExchangeRates(userCurrency);

    // Procesar el DOM
    await processDOM(document.body, rates, userCurrency, targetLang);

    // Notificar que terminó
    chrome.runtime.sendMessage({ action: "done" }).catch(() => {
      // Ignorar errores si el popup está cerrado
    });
  } catch (error) {
    console.error("Error in runTranslationAndConversion:", error);
    chrome.runtime
      .sendMessage({ action: "error", error: error.message })
      .catch(() => {});
  } finally {
    isProcessing = false;
  }
}

// Observador para contenido dinámico
const observer = new MutationObserver((mutations) => {
  let hasTextChanges = false;

  mutations.forEach((mutation) => {
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1 || node.nodeType === 3) {
          hasTextChanges = true;
        }
      });
    }
  });

  if (hasTextChanges && !isProcessing) {
    // Debounce para evitar múltiples ejecuciones
    clearTimeout(window.currencyTranslatorTimeout);
    window.currencyTranslatorTimeout = setTimeout(
      runTranslationAndConversion,
      1000
    );
  }
});

// Iniciar observador
observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Listener para mensajes del popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "reprocess") {
    // Limpiar cache y nodos procesados para reprocesar
    processedNodes = new WeakSet();
    runTranslationAndConversion();
  }
});

// Ejecutar al cargar
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runTranslationAndConversion);
} else {
  runTranslationAndConversion();
}
