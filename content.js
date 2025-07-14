async function runTranslationAndConversion() {
  const { currency, language } = await chrome.storage.sync.get([
    "currency",
    "language",
  ]);
  const userCurrency = currency || "EUR";
  const targetLang = language || "en";
  const symbols = ["JPY", "USD", "GBP", "EUR"]; // por ejemplo

  const rateResponses = await Promise.all(
    symbols.map((symbol) =>
      fetch(
        `https://api.exchangerate.host/latest?base=${symbol}&symbols=${userCurrency}`
      ).then((r) => r.json())
    )
  );

  const rates = Object.fromEntries(
    rateResponses.map((r, i) => [symbols[i], r.rates[userCurrency]])
  );

  const regexMap = {
    JPY: /(?:¥|JPY\s?)(\d+(?:[,.]\d{1,2})?)/g,
    USD: /(?:\$|USD\s?)(\d+(?:[,.]\d{1,2})?)/g,
    GBP: /(?:£|GBP\s?)(\d+(?:[,.]\d{1,2})?)/g,
    EUR: /(?:€|EUR\s?)(\d+(?:[,.]\d{1,2})?)/g,
  };

  const walk = (node) => {
    if (node.nodeType === 3) {
      let text = node.nodeValue;
      for (const [currency, regex] of Object.entries(regexMap)) {
        text = text.replace(regex, (match, num) => {
          const value = parseFloat(num.replace(/,/g, ""));
          const converted = (value * rates[currency]).toFixed(2);
          return `${match} (≈ ${converted} ${userCurrency})`;
        });
      }
      node.nodeValue = text;
    } else if (
      node.nodeType === 1 &&
      node.childNodes &&
      !["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(node.tagName)
    ) {
      for (let child of node.childNodes) walk(child);
    }
  };

  walk(document.body);

  // Translation
  const translateText = async (text, targetLang = "en") => {
    const res = await fetch("https://libretranslate.de/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "auto",
        target: targetLang,
        format: "text",
      }),
    });
    const data = await res.json();
    return data.translatedText;
  };

  const translateDOM = async (node) => {
    if (node.nodeType === 3) {
      const originalText = node.nodeValue.trim();
      if (
        originalText.length > 0 &&
        /[\u3040-\u30FF\u4E00-\u9FFF]/.test(originalText)
      ) {
        const translated = await translateText(originalText, targetLang);
        node.nodeValue = `${originalText} (${translated})`;
      }
    } else if (
      node.nodeType === 1 &&
      node.childNodes &&
      !["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"].includes(node.tagName)
    ) {
      for (let child of node.childNodes) await translateDOM(child);
    }
  };

  await translateDOM(document.body);

  // Avisar popup que terminó
  chrome.runtime.sendMessage({ action: "done" });
}

runTranslationAndConversion();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "reprocess") {
    runTranslationAndConversion();
  }
});
