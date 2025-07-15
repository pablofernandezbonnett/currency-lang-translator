// Service Worker para Manifest V3
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Configuración inicial
    chrome.storage.sync.set({
      currency: "EUR",
      language: "en",
      msgTimeout: 3,
      autoProcess: true,
    });
  }
});

// Manejar actualizaciones de la extensión
chrome.runtime.onUpdateAvailable.addListener(() => {
  chrome.runtime.reload();
});

// Limpiar cache periódicamente
// Añadir después del listener de alarmas existente alrededor de la línea 20
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    // Notificar a todos los tabs activos para limpiar cache
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { action: "clearCache" }).catch(() => {
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

// Manejar mensajes del content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Reenviar mensajes al popup si está abierto
  if (
    request.action === "done" ||
    request.action === "error" ||
    request.action === "progress"
  ) {
    chrome.runtime.sendMessage(request).catch(() => {
      // Ignorar errores si el popup no está abierto
    });
  }
});

// Manejar errores no capturados
self.addEventListener("error", (event) => {
  console.error("Background script error:", event.error);
});

// Optimización: Desactivar cuando no se necesite
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

// proper cleanup in background.js:
chrome.runtime.onSuspend.addListener(() => {
  // Clear any pending alarms
  chrome.alarms.clearAll();

  // Clean up any remaining timeouts
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { action: "cleanup" }).catch(() => {});
    });
  });
});

// Add missing alarm creation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.sync.set({
      currency: "EUR",
      language: "en",
      msgTimeout: 3,
      autoProcess: true,
    });

    // Create cache cleanup alarms
    chrome.alarms.create("clearCache", { periodInMinutes: 15 });
    chrome.alarms.create("deepCleanup", { periodInMinutes: 60 });
  }
});

// Fix alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clearCache") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (
          tab.url &&
          (tab.url.startsWith("http://") || tab.url.startsWith("https://"))
        ) {
          chrome.tabs
            .sendMessage(tab.id, { action: "clearCache" })
            .catch(() => {});
        }
      });
    });
  } else if (alarm.name === "deepCleanup") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        if (
          tab.url &&
          (tab.url.startsWith("http://") || tab.url.startsWith("https://"))
        ) {
          chrome.tabs
            .sendMessage(tab.id, { action: "deepCleanup" })
            .catch(() => {});
        }
      });
    });
  }
});
