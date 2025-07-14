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
  }
});

// Crear alarma para limpiar cache cada hora
chrome.alarms.create("clearCache", { periodInMinutes: 60 });

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
