// Small shared utilities used by service worker and other scripts.
// Keep these functions minimal so they can be loaded with `importScripts`.

// Return a safe string from various error shapes.
function getErrorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  try {
    if (err.message) return String(err.message);
    return String(err);
  } catch (e) {
    return "Unknown error";
  }
}

// Promisify a chrome.* callback API call that follows (args..., callback(result)).
function promisifyChrome(func, ...args) {
  return new Promise((resolve, reject) => {
    try {
      func(...args, (result) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(err);
        resolve(result);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Simple wrappers for local storage usage.
async function loadFromStorage(keys) {
  return await promisifyChrome(chrome.storage.local.get, keys);
}

async function saveToStorage(obj) {
  return await promisifyChrome(chrome.storage.local.set, obj);
}

// Expose on global scope when imported via importScripts
this.getErrorMessage = getErrorMessage;
this.promisifyChrome = promisifyChrome;
this.loadFromStorage = loadFromStorage;
this.saveToStorage = saveToStorage;
