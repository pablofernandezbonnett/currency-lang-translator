// Elementos del DOM
const currencySelect = document.getElementById("currency");
const languageSelect = document.getElementById("language");
const reprocessButton = document.getElementById("reprocess");
const clearCacheButton = document.getElementById("clearCache");
const statusMessage = document.getElementById("statusMessage");
const msgTimeoutInput = document.getElementById("msgTimeout");
const autoProcessCheckbox = document.getElementById("autoProcess");
const showStatsCheckbox = document.getElementById("showStats");
const compactModeCheckbox = document.getElementById("compactMode");
const statsSection = document.getElementById("statsSection");
const conversionsCount = document.getElementById("conversionsCount");
const translationsCount = document.getElementById("translationsCount");
const reprocessText = document.getElementById("reprocessText");

let statusTimeout = null;
let stats = { conversions: 0, translations: 0 };

// Enhanced storage operation with retry logic
async function safeStorageOperation(operation, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Storage operation failed (attempt ${i + 1}):`, error);
      if (i === retries - 1) {
        showStatus("Storage error occurred", "error");
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1))); // Increased delay
    }
  }
}

// Enhanced settings validation
function validateSettings(settings) {
  const defaults = {
    currency: "EUR",
    language: "en",
    msgTimeout: 3,
    autoProcess: true,
    showStats: false,
    compactMode: false,
  };

  const allowedCurrencies = ["EUR", "USD", "GBP", "JPY", "CNY", "KRW"];
  const allowedLanguages = [
    "en",
    "es",
    "fr",
    "de",
    "ja",
    "ko",
    "zh",
    "ar",
    "ru",
  ];

  return {
    currency: allowedCurrencies.includes(settings.currency)
      ? settings.currency
      : defaults.currency,
    language: allowedLanguages.includes(settings.language)
      ? settings.language
      : defaults.language,
    msgTimeout: Math.max(
      1,
      Math.min(10, parseInt(settings.msgTimeout) || defaults.msgTimeout)
    ),
    autoProcess:
      typeof settings.autoProcess === "boolean"
        ? settings.autoProcess
        : defaults.autoProcess,
    showStats:
      typeof settings.showStats === "boolean"
        ? settings.showStats
        : defaults.showStats,
    compactMode:
      typeof settings.compactMode === "boolean"
        ? settings.compactMode
        : defaults.compactMode,
  };
}

// Cargar configuraciones y estadísticas
// Enhanced loadSettings function
async function loadSettings() {
  try {
    const settings = await safeStorageOperation(() =>
      chrome.storage.sync.get([
        "currency",
        "language",
        "msgTimeout",
        "autoProcess",
        "showStats",
        "compactMode",
        "stats",
      ])
    );

    if (!settings) return;

    const validatedSettings = validateSettings(settings);

    currencySelect.value = validatedSettings.currency;
    languageSelect.value = validatedSettings.language;
    msgTimeoutInput.value = validatedSettings.msgTimeout;
    autoProcessCheckbox.checked = validatedSettings.autoProcess;
    showStatsCheckbox.checked = validatedSettings.showStats;
    compactModeCheckbox.checked = validatedSettings.compactMode;

    stats = settings.stats || { conversions: 0, translations: 0 };
    updateStatsDisplay();

    toggleStatsSection();
  } catch (error) {
    console.error("Error loading settings:", error);
    showStatus("Error loading settings", "error");
  }
}

// Guardar configuración
async function saveSetting(key, value) {
  try {
    await safeStorageOperation(() => chrome.storage.sync.set({ [key]: value }));
  } catch (error) {
    console.error("Error saving setting:", error);
    showStatus("Error saving setting", "error");
  }
}

// Actualizar display de estadísticas
function updateStatsDisplay() {
  if (conversionsCount) {
    conversionsCount.textContent = stats?.conversions || 0;
  }
  if (translationsCount) {
    translationsCount.textContent = stats?.translations || 0;
  }
}

// Mostrar/ocultar sección de estadísticas
function toggleStatsSection() {
  if (statsSection && showStatsCheckbox) {
    statsSection.style.display = showStatsCheckbox.checked ? "grid" : "none";
  }
}

// Mostrar mensaje de estado
function showStatus(msg, type = "success") {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }

  statusMessage.textContent = msg;
  statusMessage.className = type;

  // Añadir icono de loading para procesamiento
  if (type === "processing") {
    statusMessage.innerHTML = '<span class="loading"></span>' + msg;
  }

  chrome.storage.sync.get(["msgTimeout"], ({ msgTimeout }) => {
    const timeout = (msgTimeout ?? 3) * 1000;
    statusTimeout = setTimeout(() => {
      statusMessage.textContent = "";
      statusMessage.className = "";
    }, timeout);
  });
}

// Validar y normalizar valor de timeout
function validateTimeout(value) {
  let val = parseInt(value);
  if (isNaN(val) || val < 1) val = 1;
  if (val > 10) val = 10;
  return val;
}

// Resetear estadísticas
async function resetStats() {
  stats = { conversions: 0, translations: 0 };
  await saveSetting("stats", stats);
  updateStatsDisplay();
  showStatus("Statistics reset");
}

// Event listeners
currencySelect.addEventListener("change", () => {
  saveSetting("currency", currencySelect.value);
  showStatus("Currency updated");
});

languageSelect.addEventListener("change", () => {
  saveSetting("language", languageSelect.value);
  showStatus("Language updated");
});

msgTimeoutInput.addEventListener("change", () => {
  const val = validateTimeout(msgTimeoutInput.value);
  msgTimeoutInput.value = val;
  saveSetting("msgTimeout", val);
  showStatus("Message timeout updated");
});

msgTimeoutInput.addEventListener("blur", () => {
  const val = validateTimeout(msgTimeoutInput.value);
  msgTimeoutInput.value = val;
});

if (autoProcessCheckbox) {
  autoProcessCheckbox.addEventListener("change", () => {
    saveSetting("autoProcess", autoProcessCheckbox.checked);
    showStatus(
      "Auto-process " + (autoProcessCheckbox.checked ? "enabled" : "disabled")
    );
  });
}

if (showStatsCheckbox) {
  showStatsCheckbox.addEventListener("change", () => {
    saveSetting("showStats", showStatsCheckbox.checked);
    toggleStatsSection();
    showStatus(
      "Statistics " + (showStatsCheckbox.checked ? "shown" : "hidden")
    );
  });
}

if (compactModeCheckbox) {
  compactModeCheckbox.addEventListener("change", () => {
    saveSetting("compactMode", compactModeCheckbox.checked);
    showStatus(
      "Compact mode " + (compactModeCheckbox.checked ? "enabled" : "disabled")
    );
  });
}

// Reprocesar página activa
reprocessButton.addEventListener("click", async () => {
  if (reprocessText) {
    reprocessText.innerHTML = '<span class="loading"></span>Processing...';
  }

  showStatus("Processing...", "processing");
  reprocessButton.disabled = true;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs[0]?.id) {
      // Verificar si la página es procesable
      const url = tabs[0].url;
      if (
        url.startsWith("chrome://") ||
        url.startsWith("about:") ||
        !url.startsWith("http")
      ) {
        showStatus("Cannot process this page", "error");
        return;
      }

      await chrome.tabs.sendMessage(tabs[0].id, { action: "reprocess" });
    } else {
      showStatus("No active tab found", "error");
    }
  } catch (error) {
    console.error("Error reprocessing:", error);
    showStatus("Error: " + error.message, "error");
  } finally {
    reprocessButton.disabled = false;
    if (reprocessText) {
      reprocessText.innerHTML = "🔄 Reprocess";
    }
  }
});

// Limpiar cache
if (clearCacheButton) {
  clearCacheButton.addEventListener("click", async () => {
    clearCacheButton.disabled = true;

    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, { action: "clearCache" });
        showStatus("Cache cleared");
      } else {
        showStatus("No active tab found", "error");
      }
    } catch (error) {
      console.error("Error clearing cache:", error);
      showStatus("Error clearing cache", "error");
    } finally {
      clearCacheButton.disabled = false;
    }
  });
}

// Doble click en estadísticas para resetear
if (statsSection) {
  statsSection.addEventListener("dblclick", () => {
    if (confirm("Reset all statistics?")) {
      resetStats();
    }
  });
}

// Escuchar mensajes del content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "done":
      showStatus("Processing complete!", "success");
      reprocessButton.disabled = false;
      if (reprocessText) {
        reprocessText.innerHTML = "🔄 Reprocess";
      }
      break;

    case "error":
      showStatus("Error: " + (request.error || "Unknown error"), "error");
      reprocessButton.disabled = false;
      if (reprocessText) {
        reprocessText.innerHTML = "🔄 Reprocess";
      }
      break;

    case "progress":
      showStatus("Processing: " + request.message, "processing");
      break;

    case "updateStats":
      if (request.stats) {
        stats = request.stats;
        saveSetting("stats", stats);
        updateStatsDisplay();
      }
      break;
  }
});

// Verificar disponibilidad de APIs
async function checkAPIStatus() {
  try {
    // Verificar una API de ejemplo
    const response = await fetch(
      "https://api.exchangerate.host/latest?base=USD&symbols=EUR",
      {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      }
    );

    if (response.ok) {
      console.log("API services are available");
    }
  } catch (error) {
    console.warn("API check failed:", error);
  }
}

// Manejar errores no capturados
window.addEventListener("error", (event) => {
  console.error("Popup error:", event.error);
  showStatus("Unexpected error", "error");
});

// Manejar promesas rechazadas
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  showStatus("Service error", "error");
});

// Verificar si hay tabs activos al abrir popup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs.length === 0) {
    reprocessButton.disabled = true;
    clearCacheButton.disabled = true;
    showStatus("No active tab", "error");
  } else {
    const url = tabs[0].url;
    if (
      url.startsWith("chrome://") ||
      url.startsWith("about:") ||
      url.startsWith("moz-extension://")
    ) {
      reprocessButton.disabled = true;
      clearCacheButton.disabled = true;
      showStatus("Page not supported", "error");
    }
  }
});

// Inicializar
document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  checkAPIStatus();

  // Añadir tooltips
  if (reprocessButton) {
    reprocessButton.title = "Reprocess current page content";
  }
  if (clearCacheButton) {
    clearCacheButton.title = "Clear translation and currency cache";
  }
  if (autoProcessCheckbox) {
    autoProcessCheckbox.title = "Automatically process new content as it loads";
  }
  if (showStatsCheckbox) {
    showStatsCheckbox.title = "Show conversion and translation statistics";
  }
});
