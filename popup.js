const currencySelect = document.getElementById("currency");
const languageSelect = document.getElementById("language");
const reprocessButton = document.getElementById("reprocess");
const statusMessage = document.getElementById("statusMessage");
const msgTimeoutInput = document.getElementById("msgTimeout");

// Elementos adicionales
const clearCacheButton = document.getElementById("clearCache");
const autoProcessCheckbox = document.getElementById("autoProcess");

let statusTimeout = null;

// Cargar configuraciones guardadas
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      "currency",
      "language",
      "msgTimeout",
      "autoProcess",
    ]);

    if (settings.currency) currencySelect.value = settings.currency;
    if (settings.language) languageSelect.value = settings.language;
    msgTimeoutInput.value = settings.msgTimeout ?? 3;
    if (autoProcessCheckbox)
      autoProcessCheckbox.checked = settings.autoProcess ?? true;
  } catch (error) {
    console.error("Error loading settings:", error);
    showStatus("Error loading settings", "error");
  }
}

// Guardar configuración
async function saveSetting(key, value) {
  try {
    await chrome.storage.sync.set({ [key]: value });
  } catch (error) {
    console.error("Error saving setting:", error);
    showStatus("Error saving setting", "error");
  }
}

// Mostrar mensaje de estado
function showStatus(msg, type = "success") {
  if (statusTimeout) {
    clearTimeout(statusTimeout);
  }

  statusMessage.textContent = msg;
  statusMessage.className = type;

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
});

if (autoProcessCheckbox) {
  autoProcessCheckbox.addEventListener("change", () => {
    saveSetting("autoProcess", autoProcessCheckbox.checked);
    showStatus(
      "Auto-process " + (autoProcessCheckbox.checked ? "enabled" : "disabled")
    );
  });
}

// Reprocesar página activa
reprocessButton.addEventListener("click", async () => {
  showStatus("Processing...", "processing");
  reprocessButton.disabled = true;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tabs[0]?.id) {
      await chrome.tabs.sendMessage(tabs[0].id, { action: "reprocess" });
    } else {
      showStatus("No active tab found", "error");
    }
  } catch (error) {
    console.error("Error reprocessing:", error);
    showStatus("Error: " + error.message, "error");
  } finally {
    reprocessButton.disabled = false;
  }
});

// Limpiar cache
if (clearCacheButton) {
  clearCacheButton.addEventListener("click", async () => {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tabs[0]?.id) {
        await chrome.tabs.sendMessage(tabs[0].id, { action: "clearCache" });
        showStatus("Cache cleared");
      }
    } catch (error) {
      console.error("Error clearing cache:", error);
      showStatus("Error clearing cache", "error");
    }
  });
}

// Escuchar mensajes del content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "done":
      showStatus("Done!", "success");
      break;
    case "error":
      showStatus("Error: " + (request.error || "Unknown error"), "error");
      break;
    case "progress":
      showStatus("Processing: " + request.message, "processing");
      break;
  }
});

// Manejar errores no capturados
window.addEventListener("error", (event) => {
  console.error("Popup error:", event.error);
  showStatus("Unexpected error", "error");
});

// Inicializar
loadSettings();
