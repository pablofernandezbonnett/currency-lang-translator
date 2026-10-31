const currencySelect = document.getElementById("currency");
const reprocessButton = document.getElementById("reprocess");
const clearCacheButton = document.getElementById("clearCache");
const statusMessage = document.getElementById("statusMessage");
const msgTimeoutInput = document.getElementById("msgTimeout");
const autoProcessCheckbox = document.getElementById("autoProcess");
const showStatsCheckbox = document.getElementById("showStats");
const compactModeCheckbox = document.getElementById("compactMode");
const statsSection = document.getElementById("statsSection");
const conversionsCount = document.getElementById("conversionsCount");
const reprocessText = document.getElementById("reprocessText");
const resetStatsButton = document.getElementById("resetStats");
const versionText = document.getElementById("versionText");
const hasExtensionApis =
  typeof chrome !== "undefined" &&
  !!chrome.runtime?.id &&
  !!chrome.storage?.sync &&
  !!chrome.tabs;
const FALLBACK_VERSION = "1.0.0";

const DEFAULT_SETTINGS = {
  currency: "EUR",
  msgTimeout: 3,
  autoProcess: true,
  showStats: false,
  compactMode: false,
};

const ALLOWED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CNY", "KRW"];

let statusTimeout = null;
let stats = { conversions: 0 };

function normalizeStats(value) {
  return {
    conversions:
      value && Number.isFinite(value.conversions) ? value.conversions : 0,
  };
}

async function safeStorageOperation(operation, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      console.error(
        `Storage operation failed (attempt ${attempt + 1}):`,
        error
      );

      if (attempt === retries - 1) {
        showStatus("Storage error occurred", "error");
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }

  return null;
}

function validateSettings(settings) {
  return {
    currency: ALLOWED_CURRENCIES.includes(settings.currency)
      ? settings.currency
      : DEFAULT_SETTINGS.currency,
    msgTimeout: Math.max(
      1,
      Math.min(10, parseInt(settings.msgTimeout, 10) || DEFAULT_SETTINGS.msgTimeout)
    ),
    autoProcess:
      typeof settings.autoProcess === "boolean"
        ? settings.autoProcess
        : DEFAULT_SETTINGS.autoProcess,
    showStats:
      typeof settings.showStats === "boolean"
        ? settings.showStats
        : DEFAULT_SETTINGS.showStats,
    compactMode:
      typeof settings.compactMode === "boolean"
        ? settings.compactMode
        : DEFAULT_SETTINGS.compactMode,
  };
}

function validateTimeout(value) {
  let parsedValue = parseInt(value, 10);

  if (Number.isNaN(parsedValue) || parsedValue < 1) {
    parsedValue = 1;
  }

  if (parsedValue > 10) {
    parsedValue = 10;
  }

  return parsedValue;
}

function isSupportedUrl(url) {
  return (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  );
}

async function getActiveTab() {
  if (!hasExtensionApis) {
    return null;
  }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function getMessageTimeout() {
  const inputValue = msgTimeoutInput ? msgTimeoutInput.value : DEFAULT_SETTINGS.msgTimeout;
  return validateTimeout(inputValue ?? DEFAULT_SETTINGS.msgTimeout) * 1000;
}

function setReprocessButtonLoading(isLoading) {
  if (!reprocessButton || !reprocessText) {
    return;
  }

  reprocessButton.disabled = isLoading;
  reprocessText.textContent = isLoading ? "Processing..." : "Process";
}

function updateStatsDisplay() {
  if (conversionsCount) {
    conversionsCount.textContent = String(stats?.conversions || 0);
  }
}

function toggleStatsSection() {
  if (!statsSection || !showStatsCheckbox) {
    return;
  }

  const isVisible = showStatsCheckbox.checked;
  statsSection.hidden = !isVisible;

  if (resetStatsButton) {
    resetStatsButton.disabled = !isVisible;
  }
}

function showStatus(message, type = "success") {
  if (!statusMessage) {
    return;
  }

  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }

  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();

  const timeout = getMessageTimeout();
  statusTimeout = setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.className = "status-message";
  }, timeout);
}

async function saveSetting(key, value) {
  if (!hasExtensionApis) {
    return false;
  }

  const result = await safeStorageOperation(() =>
    chrome.storage.sync.set({ [key]: value })
  );

  if (result === null) {
    console.error(`Failed to save setting: ${key}`);
    return false;
  }
  return true;
}

async function persistSetting(key, value, successMessage) {
  if (await saveSetting(key, value)) {
    showStatus(successMessage);
    return;
  }
  await loadSettings();
  showStatus("Setting could not be saved", "error");
}

async function loadSettings() {
  if (!hasExtensionApis) {
    return;
  }

  try {
    const settings = await safeStorageOperation(() =>
      chrome.storage.sync.get([
        "currency",
        "msgTimeout",
        "autoProcess",
        "showStats",
        "compactMode",
        "stats",
      ])
    );

    if (!settings) {
      return;
    }

    const validated = validateSettings(settings);

    currencySelect.value = validated.currency;
    msgTimeoutInput.value = String(validated.msgTimeout);
    autoProcessCheckbox.checked = validated.autoProcess;
    showStatsCheckbox.checked = validated.showStats;
    compactModeCheckbox.checked = validated.compactMode;

    stats = normalizeStats(settings.stats);
    updateStatsDisplay();
    toggleStatsSection();
  } catch (error) {
    console.error("Error loading settings:", error);
    showStatus("Error loading settings", "error");
  }
}

async function resetStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "resetStats" });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to reset statistics.");
    }
    stats = { conversions: 0 };
    updateStatsDisplay();
    showStatus("Statistics reset");
  } catch (error) {
    console.error("Error resetting statistics:", error);
    showStatus("Statistics could not be reset", "error");
  }
}

async function updateActionAvailability() {
  if (!hasExtensionApis) {
    return;
  }

  const tab = await getActiveTab();

  if (!tab) {
    reprocessButton.disabled = true;
    clearCacheButton.disabled = true;
    showStatus("No active tab", "error");
    return;
  }

  if (!isSupportedUrl(tab.url)) {
    reprocessButton.disabled = true;
    clearCacheButton.disabled = false;
    showStatus("Page not supported", "error");
    return;
  }

  reprocessButton.disabled = false;
  clearCacheButton.disabled = false;
}

function enablePreviewMode() {
  [
    currencySelect,
    msgTimeoutInput,
    autoProcessCheckbox,
    showStatsCheckbox,
    compactModeCheckbox,
    reprocessButton,
    clearCacheButton,
    resetStatsButton,
  ].forEach((element) => {
    if (element) {
      element.disabled = true;
    }
  });

  showStatus(
    "Preview only. Load this UI through the extension to use live settings.",
    "processing"
  );
}

function updateVersionLabel() {
  if (!versionText) {
    return;
  }

  const runtimeVersion =
    hasExtensionApis && typeof chrome.runtime?.getManifest === "function"
      ? chrome.runtime.getManifest().version
      : FALLBACK_VERSION;

  versionText.textContent = `v${runtimeVersion || FALLBACK_VERSION}`;
}

currencySelect.addEventListener("change", async () => {
  await persistSetting("currency", currencySelect.value, "Currency updated");
});

msgTimeoutInput.addEventListener("change", async () => {
  const timeout = validateTimeout(msgTimeoutInput.value);
  msgTimeoutInput.value = String(timeout);
  await persistSetting("msgTimeout", timeout, "Message timeout updated");
});

msgTimeoutInput.addEventListener("blur", () => {
  msgTimeoutInput.value = String(validateTimeout(msgTimeoutInput.value));
});

autoProcessCheckbox.addEventListener("change", async () => {
  await persistSetting(
    "autoProcess",
    autoProcessCheckbox.checked,
    `Auto-process ${autoProcessCheckbox.checked ? "enabled" : "disabled"}`
  );
});

showStatsCheckbox.addEventListener("change", async () => {
  toggleStatsSection();
  await persistSetting(
    "showStats",
    showStatsCheckbox.checked,
    `Statistics ${showStatsCheckbox.checked ? "shown" : "hidden"}`
  );
});

compactModeCheckbox.addEventListener("change", async () => {
  await persistSetting(
    "compactMode",
    compactModeCheckbox.checked,
    `Compact mode ${compactModeCheckbox.checked ? "enabled" : "disabled"}`
  );
});

reprocessButton.addEventListener("click", async () => {
  setReprocessButtonLoading(true);
  showStatus("Processing...", "processing");

  try {
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      showStatus("No active tab found", "error");
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      showStatus("Cannot process this page", "error");
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, { action: "reprocess" });
    if (!response?.ok) {
      throw new Error(response?.error || "Unable to process this page.");
    }
    showStatus("Processing complete!", "success");
  } catch (error) {
    const message =
      error && typeof error === "object" && error.message
        ? error.message
        : String(error);

    console.error("Error reprocessing:", message);

    if (message.includes("Receiving end does not exist")) {
      showStatus("Connection failed. Please reload the page and try again.", "error");
    } else {
      showStatus(`Error: ${message}`, "error");
    }
  } finally {
    setReprocessButtonLoading(false);
  }
});

clearCacheButton.addEventListener("click", async () => {
  clearCacheButton.disabled = true;

  try {
    const workerResponse = await chrome.runtime.sendMessage({
      action: "clearBackgroundCaches",
    });

    if (!workerResponse?.ok) {
      throw new Error(workerResponse?.error || "Unable to clear rate cache.");
    }

    const tab = await getActiveTab();
    let pageCleared = false;
    if (tab && tab.id && isSupportedUrl(tab.url)) {
      const pageResponse = await chrome.tabs.sendMessage(tab.id, {
        action: "clearCache",
      }).catch(() => null);
      pageCleared = pageResponse?.ok === true;
    }

    showStatus(pageCleared ? "Caches cleared" : "Rate cache cleared; reload page to reset text");
  } catch (error) {
    const message =
      error && typeof error === "object" && error.message
        ? error.message
        : String(error);

    console.error("Error clearing caches:", message);
    showStatus("Error clearing caches", "error");
  } finally {
    clearCacheButton.disabled = false;
    updateActionAvailability().catch(() => {});
  }
});

if (resetStatsButton) {
  resetStatsButton.addEventListener("click", () => {
    if (confirm("Reset local conversion statistics?")) {
      resetStats();
    }
  });
}

if (hasExtensionApis && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.stats) {
      stats = normalizeStats(changes.stats.newValue);
      updateStatsDisplay();
    }
  });
}

window.addEventListener("error", (event) => {
  console.error("Popup error:", event.error);
  showStatus("Unexpected error", "error");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  showStatus("Service error", "error");
});

document.addEventListener("DOMContentLoaded", async () => {
  updateVersionLabel();

  reprocessButton.title = "Reprocess current page prices";
  clearCacheButton.title = "Clear cached rates and page markers";
  autoProcessCheckbox.title = "Automatically scan new content for prices";
  showStatsCheckbox.title = "Show conversion statistics";
  compactModeCheckbox.title = "Use a shorter inline display for currency conversions";

  if (resetStatsButton) {
    resetStatsButton.title = "Reset locally stored conversion statistics";
  }

  toggleStatsSection();

  if (!hasExtensionApis) {
    enablePreviewMode();
    return;
  }

  await loadSettings();
  await updateActionAvailability();
});
