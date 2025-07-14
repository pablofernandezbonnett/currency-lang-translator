const currencySelect = document.getElementById("currency");
const languageSelect = document.getElementById("language");
const reprocessButton = document.getElementById("reprocess");
const statusMessage = document.getElementById("statusMessage");
const msgTimeoutInput = document.getElementById("msgTimeout");

// Carga configuraciones
chrome.storage.sync.get(
  ["currency", "language", "msgTimeout"],
  ({ currency, language, msgTimeout }) => {
    if (currency) currencySelect.value = currency;
    if (language) languageSelect.value = language;
    msgTimeoutInput.value = msgTimeout ?? 3;
  }
);

// Guarda cambios
const saveSetting = (key, value) => chrome.storage.sync.set({ [key]: value });

currencySelect.addEventListener("change", () => {
  saveSetting("currency", currencySelect.value);
});
languageSelect.addEventListener("change", () => {
  saveSetting("language", languageSelect.value);
});
msgTimeoutInput.addEventListener("change", () => {
  let val = parseInt(msgTimeoutInput.value);
  if (isNaN(val) || val < 1) val = 3;
  if (val > 10) val = 10;
  msgTimeoutInput.value = val;
  saveSetting("msgTimeout", val);
});

// Mostrar estado
const showStatus = (msg) => {
  statusMessage.textContent = msg;
  chrome.storage.sync.get(["msgTimeout"], ({ msgTimeout }) => {
    const timeout = (msgTimeout ?? 3) * 1000;
    setTimeout(() => {
      statusMessage.textContent = "";
    }, timeout);
  });
};

// Reprocesar la página activa
reprocessButton.addEventListener("click", () => {
  showStatus("Processing...");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "reprocess" });
    }
  });
});

// Escuchar mensaje de finalización
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "done") {
    showStatus("Done!");
  }
});
