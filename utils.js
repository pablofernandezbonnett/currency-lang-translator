// Small service-worker helpers loaded through `importScripts`.

function getErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  try {
    if (error.message) return String(error.message);
    return String(error);
  } catch {
    return "Unknown error";
  }
}

async function loadFromStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function saveToStorage(obj) {
  await chrome.storage.local.set(obj);
}

this.getErrorMessage = getErrorMessage;
this.loadFromStorage = loadFromStorage;
this.saveToStorage = saveToStorage;
