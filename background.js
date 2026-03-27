/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Initialize default storage on first install
 *  - Handle messages from content scripts if needed in the future
 *  - Keep the service worker alive for storage operations
 */

// ─── Install Handler ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    // Seed storage defaults on first install
    const defaults = {
      activeText: '',
      recentGroups: [],
      selectedGroupIds: [],
      bulkPostDelay: {
        enabled: false,
        minMs: 2000,
        maxMs: 6000,
      },
    };

    await chrome.storage.local.set(defaults);
    console.log('[QuickPost] Extension installed. Storage initialized.', defaults);
    return;
  }

  if (reason === 'update') {
    await chrome.storage.local.remove('templates');
    console.log('[QuickPost] Extension updated. Legacy templates storage removed.');
  }
});

// ─── Message Router ─────────────────────────────────────────────────────────

/**
 * Central message handler.
 * Content scripts / popup may send messages here for privileged operations.
 *
 * Supported actions:
 *   { action: 'getStorage' }  → returns full storage snapshot
 *   { action: 'ping' }        → health-check, returns { pong: true }
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.action) return;

  switch (message.action) {
    case 'ping':
      sendResponse({ pong: true });
      return true;

    case 'getStorage': {
      chrome.storage.local.get(null).then((data) => {
        sendResponse({ ok: true, data });
      });
      return true; // keep channel open for async response
    }

    default:
      console.warn('[QuickPost] Unknown message action:', message.action);
  }
});
