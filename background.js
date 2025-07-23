// Manejar actualizaciones de la extensión
chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

// Unified alarm listener for all alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch((e) => {
          // Ignorar errores si el tab no puede recibir mensajes
        });
      });
    });
  } else if (alarm.name === "deepCleanup") {
    // Limpieza profunda cada hora
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs
          .sendMessage(tab.id, { action: "deepCleanup" })
          .catch(() => {});
      });
    });
  }
});

// Crear alarma adicional para limpieza profunda
chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });

// Improved message handling with error catching
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (["done", "error", "progress", "updateStats"].includes(request.action)) {
    chrome.runtime.sendMessage(request).catch((e) => {
      console.warn("Could not send message to popup:", e);
    });
  } else if (request.action === "getSettings") {
    // Example for handling a request from the popup
    chrome.storage.sync.get(null, sendResponse); // Send all settings
    return true; // Keep the channel open for sendResponse
  }
});

// Catch unhandled errors in the service worker
self.addEventListener("error", (event) => {
  console.error("Background script error:", event.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    // Solo activar en páginas web (no en chrome://, about:, etc.)
    if (tab.url.startsWith("http://") || tab.url.startsWith("https://")) {
      chrome.action.enable(tabId);
    } else {
      chrome.action.disable(tabId);
    }
  }
});

// Enhanced cleanup on suspend
chrome.runtime.onSuspend.addListener(() => {
  // Clear any pending alarms
  chrome.alarms.clearAll();

  // Clean up any remaining timeouts
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: "cleanup" }).catch((e) => {
        console.warn("Cleanup message failed for tab", tab.id, ":", e);
      });
    });
  });
});

// Improved installation handling and alarm creation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    const defaultSettings = {
      currency: "EUR",
      language: "en",
      msgTimeout: 3,
      autoProcess: true,
      showStats: false,
      stats: { conversions: 0, translations: 0 },
    };
    chrome.storage.sync.set(defaultSettings).then(() => {
      // Create cache cleanup alarms after settings are initialized
      chrome.alarms.create("clearCache", { periodInMinutes: 15 });
      chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });
    });
  }
});
