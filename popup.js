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
let awaitingProcessingResult = false;
let isShowingStorageError = false;

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
        if (!isShowingStorageError) {
          isShowingStorageError = true;
          showStatus("Storage error occurred", "error").finally(() => {
            isShowingStorageError = false;
          });
        }
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
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getMessageTimeout() {
  const inputValue = msgTimeoutInput ? msgTimeoutInput.value : DEFAULT_SETTINGS.msgTimeout;
  return validateTimeout(inputValue ?? DEFAULT_SETTINGS.msgTimeout) * 1000;
}

function setReprocessButtonLoading(isLoading) {
  if (!reprocessButton || !reprocessText) {
    return;
  }

  reprocessButton.disabled = isLoading;
  reprocessText.textContent = isLoading ? "Processing..." : "🔄 Process";
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

  statsSection.style.display = showStatsCheckbox.checked ? "grid" : "none";
}

async function showStatus(message, type = "success") {
  if (!statusMessage) {
    return;
  }

  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }

  statusMessage.textContent = message;
  statusMessage.className = type;

  const timeout = await getMessageTimeout();
  statusTimeout = setTimeout(() => {
    statusMessage.textContent = "";
    statusMessage.className = "";
  }, timeout);
}

async function saveSetting(key, value) {
  const result = await safeStorageOperation(() =>
    chrome.storage.sync.set({ [key]: value })
  );

  if (result === null) {
    console.error(`Failed to save setting: ${key}`);
  }
}

async function loadSettings() {
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
  stats = { conversions: 0 };
  await saveSetting("stats", stats);
  updateStatsDisplay();
  showStatus("Statistics reset");
}

async function updateActionAvailability() {
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

currencySelect.addEventListener("change", async () => {
  await saveSetting("currency", currencySelect.value);
  showStatus("Currency updated");
});

msgTimeoutInput.addEventListener("change", async () => {
  const timeout = validateTimeout(msgTimeoutInput.value);
  msgTimeoutInput.value = String(timeout);
  await saveSetting("msgTimeout", timeout);
  showStatus("Message timeout updated");
});

msgTimeoutInput.addEventListener("blur", () => {
  msgTimeoutInput.value = String(validateTimeout(msgTimeoutInput.value));
});

autoProcessCheckbox.addEventListener("change", async () => {
  await saveSetting("autoProcess", autoProcessCheckbox.checked);
  showStatus(
    `Auto-process ${autoProcessCheckbox.checked ? "enabled" : "disabled"}`
  );
});

showStatsCheckbox.addEventListener("change", async () => {
  await saveSetting("showStats", showStatsCheckbox.checked);
  toggleStatsSection();
  showStatus(
    `Statistics ${showStatsCheckbox.checked ? "shown" : "hidden"}`
  );
});

compactModeCheckbox.addEventListener("change", async () => {
  await saveSetting("compactMode", compactModeCheckbox.checked);
  showStatus(
    `Compact mode ${compactModeCheckbox.checked ? "enabled" : "disabled"}`
  );
});

reprocessButton.addEventListener("click", async () => {
  awaitingProcessingResult = true;
  setReprocessButtonLoading(true);
  showStatus("Processing...", "processing");

  try {
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      awaitingProcessingResult = false;
      showStatus("No active tab found", "error");
      return;
    }

    if (!isSupportedUrl(tab.url)) {
      awaitingProcessingResult = false;
      showStatus("Cannot process this page", "error");
      return;
    }

    await chrome.tabs.sendMessage(tab.id, { action: "reprocess" });
  } catch (error) {
    awaitingProcessingResult = false;
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
    if (!awaitingProcessingResult) {
      setReprocessButtonLoading(false);
    }
  }
});

clearCacheButton.addEventListener("click", async () => {
  clearCacheButton.disabled = true;

  try {
    const workerResponse = await chrome.runtime.sendMessage({
      action: "clearBackgroundCaches",
    });

    if (workerResponse && workerResponse.error) {
      throw new Error(workerResponse.error);
    }

    const tab = await getActiveTab();
    if (tab && tab.id && isSupportedUrl(tab.url)) {
      await chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch(() => {
        // Clearing content-script state is best effort only.
      });
    }

    showStatus("Caches cleared");
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

if (statsSection) {
  statsSection.addEventListener("dblclick", () => {
    if (confirm("Reset all statistics?")) {
      resetStats();
    }
  });
}

chrome.runtime.onMessage.addListener((request) => {
  switch (request.action) {
    case "done":
      awaitingProcessingResult = false;
      setReprocessButtonLoading(false);
      showStatus("Processing complete!", "success");
      break;
    case "error":
      awaitingProcessingResult = false;
      setReprocessButtonLoading(false);
      showStatus(`Error: ${request.error || "Unknown error"}`, "error");
      break;
    case "progress":
      showStatus(`Processing: ${request.message}`, "processing");
      break;
    case "updateStats":
      if (request.stats) {
        stats = normalizeStats(request.stats);
        updateStatsDisplay();
      }
      break;
    default:
      break;
  }
});

window.addEventListener("error", (event) => {
  console.error("Popup error:", event.error);
  showStatus("Unexpected error", "error");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  showStatus("Service error", "error");
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await updateActionAvailability();

  reprocessButton.title = "Reprocess current page prices";
  clearCacheButton.title = "Clear cached rates and page markers";
  autoProcessCheckbox.title = "Automatically scan new content for prices";
  showStatsCheckbox.title = "Show conversion statistics";
  compactModeCheckbox.title = "Use a shorter inline display for currency conversions";
});
