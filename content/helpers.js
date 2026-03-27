/**
 * content/helpers.js
 *
 * Utility functions shared between injectButtons.js and injectGraphQL.js.
 * Runs in MAIN world (page context) so it has access to window globals.
 */

window.__QGP = window.__QGP || {};

const Helpers = {
  // ─── Group ID Extraction ─────────────────────────────────────────────────

  /**
   * Given a "View group" anchor element (or any child), walks up to find the
   * group row container and extracts the Facebook Group ID.
   *
   * Strategy:
   *  1. Parse the /groups/<id>/ segment from an <a href> in the same row.
   *  2. Fallback: look for data attributes on the row.
   *
   * @param {Element} rowEl — the group card / row container element
   * @returns {string|null} group id or null if not found
   */
  extractGroupId (rowEl) {
    // Strategy 1: find a link whose href contains /groups/<id>/
    const anchors = rowEl.querySelectorAll('a[href*="/groups/"]');
    for (const a of anchors) {
      const id = Helpers.parseGroupIdFromUrl(a.href);
      if (id) return id;
    }
    // Strategy 2: data attributes (Facebook sometimes embeds entity IDs)
    const withData = rowEl.querySelector('[data-group-id]');
    if (withData) return withData.dataset.groupId;

    return null;
  },

  /**
   * Parse the numeric/slug group ID from a Facebook groups URL.
   * Handles:
   *   https://www.facebook.com/groups/123456789/
   *   https://www.facebook.com/groups/mygroupslug/
   *
   * @param {string} url
   * @returns {string|null}
   */
  parseGroupIdFromUrl (url) {
    try {
      const { pathname } = new URL(url);
      // pathname: /groups/<id>/...
      const match = pathname.match(/^\/groups\/([^/?#]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  },

  // ─── Facebook Token Extraction ───────────────────────────────────────────

  /**
   * Retrieve fb_dtsg token required for all internal Facebook API calls.
   *
   * Attempts (in order):
   *  1. require("DTSGInitialData").token  (Comet / SPA bundles)
   *  2. Hidden input[name="fb_dtsg"]
   *  3. Meta tag content
   *  4. Regex scan of inline scripts
   *
   * @returns {string|null}
   */
  getFbDtsg () {
    // Attempt 1: Comet module registry
    try {
      // eslint-disable-next-line no-undef
      const dtsg = require('DTSGInitialData');
      if (dtsg && dtsg.token) return dtsg.token;
    } catch (_) { /* module not available */ }

    // Attempt 2: hidden input
    const input = document.querySelector('input[name="fb_dtsg"]');
    if (input && input.value) return input.value;

    // Attempt 3: meta[name="fb_dtsg"]
    const meta = document.querySelector('meta[name="fb_dtsg"]');
    if (meta && meta.content) return meta.content;

    // Attempt 4: inline script scan
    const scripts = document.querySelectorAll('script[nonce], script:not([src])');
    for (const s of scripts) {
      const m = s.textContent.match(/"token"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }

    console.warn('[QuickPost] fb_dtsg not found');
    return null;
  },

  /**
   * Retrieve lsd (Lazy Security Descriptor) token.
   * Used as a lightweight CSRF token on Facebook.
   *
   * @returns {string|null}
   */
  getLsd () {
    // Attempt 1: Comet module registry
    try {
      // eslint-disable-next-line no-undef
      const lsdData = require('LSD');
      if (lsdData && lsdData.token) return lsdData.token;
    } catch (_) { /* not available */ }

    // Attempt 2: hidden input
    const input = document.querySelector('input[name="lsd"]');
    if (input && input.value) return input.value;

    // Attempt 3: scan inline scripts for "LSD",[],{"token":"..."
    const scripts = document.querySelectorAll('script:not([src])');
    for (const s of scripts) {
      const m = s.textContent.match(/"LSD",\[\],\{"token"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }

    console.warn('[QuickPost] lsd not found');
    return null;
  },

  /**
   * Retrieve __spin_r and __spin_t from window.__spin_r / __spin_t
   * or from inline page data.
   *
   * @returns {{ spin_r: string|null, spin_t: string|null }}
   */
  getSpinTokens () {
    const spin_r = window.__spin_r ?? null;
    const spin_t = window.__spin_t ?? null;
    return { spin_r, spin_t };
  },

  /**
   * Retrieve the current user's Facebook numeric user ID.
   *
   * Attempts (in order):
   *  1. require("CurrentUserInitialData").USER_ID
   *  2. window.USER_ID / window.__userID
   *  3. Profile link href in the nav bar
   *
   * @returns {string|null}
   */
  getCurrentUserId () {
    // Attempt 1: Comet module
    try {
      // eslint-disable-next-line no-undef
      const userData = require('CurrentUserInitialData');
      if (userData && userData.USER_ID) return String(userData.USER_ID);
    } catch (_) { /* not available */ }

    // Attempt 2: legacy window globals
    if (window.USER_ID) return String(window.USER_ID);
    if (window.__userID) return String(window.__userID);

    // Attempt 3: profile link in top nav
    const profileLink = document.querySelector(
      'a[href*="facebook.com/"][aria-label][role="link"]'
    );
    if (profileLink) {
      const uid = Helpers.parseGroupIdFromUrl(profileLink.href);
      // Only return if it's a numeric ID
      if (uid && /^\d+$/.test(uid)) return uid;
    }

    console.warn('[QuickPost] Current user ID not found');
    return null;
  },

  /**
   * Generate a random composer session ID (UUID v4-like).
   * Facebook generates one per composer open; we mimic that here.
   *
   * @returns {string}
   */
  generateComposerSessionId () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
};

window.__QGP.Helpers = Helpers;
