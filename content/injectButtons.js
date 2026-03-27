/**
 * content/injectButtons.js
 *
 * Runs in the ISOLATED content-script world on:
 *   https://www.facebook.com/groups/joins/
 *
 * This world has access to chrome.* APIs (including chrome.storage.local)
 * but NOT to the page's real window globals (require(), __spin_r, etc.).
 *
 * Architecture
 * ────────────
 *   ISOLATED world (this file)
 *     - Reads active post content via chrome.storage.local
 *     - Injects UI buttons into the DOM
 *     - Triggers posting by injecting an inline <script> that calls
 *       window.__QGP.GraphQL.postToGroup() in the MAIN world
 *     - Receives result via window.addEventListener('message', …)
 *
 *   MAIN world scripts (injected once as <script src=…> on page load):
 *     - content/helpers.js       → window.__QGP.Helpers
 *     - content/injectGraphQL.js → window.__QGP.GraphQL
 *
 * Message protocol (MAIN → ISOLATED via postMessage):
 *   { source: 'QGP_RESULT', requestId, ok, postId?, groupId?, error? }
 */

(function () {
  'use strict';

  // ─── Inject MAIN-world scripts once ─────────────────────────────────────────

  /**
   * Inject a web_accessible_resource JS file into the MAIN world by
   * appending a <script src="…"> to document.head.
   *
   * @param {string} relativePath — extension-relative path e.g. "content/helpers.js"
   * @returns {Promise<void>} resolves when the script fires its load event
   */
  function injectMainScript (relativePath) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL(relativePath);
      s.type = 'text/javascript';
      s.addEventListener('load', resolve);
      s.addEventListener('error', () =>
        reject(new Error('[QuickPost] Failed to load ' + relativePath))
      );
      (document.head || document.documentElement).appendChild(s);
      // Keep tag in DOM so the browser doesnt reload on next injection
    });
  }

  // Chain: helpers must be available before injectGraphQL references them
  const pageScriptsReady = injectMainScript('content/helpers.js')
    .then(() => {
      console.log('[QuickPost] ✅ helpers.js injected into MAIN world');
      return injectMainScript('content/injectGraphQL.js');
    })
    .then(() => {
      console.log('[QuickPost] ✅ injectGraphQL.js injected into MAIN world');
      console.log('[QuickPost] 🟢 All MAIN-world scripts ready.');
    })
    .catch((err) =>
      console.error('[QuickPost] ❌ MAIN-world script injection failed:', err)
    );

  // ─── Result listener (MAIN → ISOLATED via postMessage) ──────────────────────

  // Map<requestId, { resolve, reject }>
  const pendingRequests = new Map();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'QGP_RESULT') return;

    console.log('[QuickPost] 📨 Received QGP_RESULT from MAIN world:', {
      requestId: msg.requestId,
      ok: msg.ok,
      postId: msg.postId || null,
      groupId: msg.groupId || null,
      error: msg.error || null,
    });

    const pending = pendingRequests.get(msg.requestId);
    if (!pending) {
      console.warn('[QuickPost] ⚠️ No pending request for id:', msg.requestId);
      return;
    }
    pendingRequests.delete(msg.requestId);

    if (msg.ok) {
      pending.resolve({ postId: msg.postId, groupId: msg.groupId });
    } else {
      pending.reject(new Error(msg.error || 'Unknown error from MAIN world'));
    }
  });

  // ─── Trigger a post from ISOLATED world ──────────────────────────────────────

  /**
   * Ask the MAIN world to post to a group.
   * Injects a tiny inline <script> that calls window.__QGP.GraphQL.postToGroup()
   * and sends the result back via window.postMessage.
   *
   * @param {string} groupId
   * @param {string} messageText
   * @returns {Promise<{ postId: string, groupId: string }>}
   */
  function triggerPost (groupId, messageText) {
    return new Promise((resolve, reject) => {
      const requestId = 'qgp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      pendingRequests.set(requestId, { resolve, reject });
      console.log('[QuickPost] 🚀 triggerPost called:', {
        groupId,
        requestId,
        messagePreview: messageText.slice(0, 80) + (messageText.length > 80 ? '…' : ''),
      });

      // Send to MAIN world via postMessage — avoids inline <script> which is
      // blocked by Facebook's Content Security Policy.
      // injectGraphQL.js (already loaded in MAIN world) listens for QGP_REQUEST.
      console.log('[QuickPost] 📤 Sending QGP_REQUEST to MAIN world, requestId:', requestId);
      window.postMessage({
        source: 'QGP_REQUEST',
        requestId,
        groupId,
        messageText,
      }, '*');

      // Safety timeout — reject if no response within 30 s
      setTimeout(function () {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
          console.error('[QuickPost] ⏰ Post timed out after 30 s for requestId:', requestId);
          reject(new Error('[QuickPost] Post timed out after 30 s'));
        }
      }, 30000);
    });
  }

  // ─── Selectors ──────────────────────────────────────────────────────────────

  /**
   * Text strings that identify a "View/Visit group" button.
   * Tested against each text node individually (not combined with aria-label).
   *
   * Covers both the Joined Groups page (/groups/joins/) and the
   * Group Search results page (/groups/search/groups_home/?q=…):
   *   - Joined Groups page: "View group" / "Xem nhóm"
   *   - Search results page: "Visit" for already-joined groups
   */
  const VIEW_GROUP_TEXTS = new Set([
    // ── English ────────────────────────────────────────────────────────────
    'view group',      // Joined groups page
    'visit group',
    'see group',
    'visit',           // Search results page — button for already-joined groups

    // ── Vietnamese ─────────────────────────────────────────────────────────
    'xem nhóm',        // "View group"
    'truy cập',        // "Visit / Access"
    'thăm nhóm',       // "Visit group"
  ]);

  /** Attribute we stamp on injected buttons to avoid duplicate injection */
  const INJECTED_ATTR = 'data-qgp-injected';

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Starting from a text node whose content is "View group", walk UP the DOM
   * to find the nearest clickable ancestor:
   *   <a>, <button>, or any element with role="button"
   * Limit to 8 levels so we don't escape the card.
   *
   * @param {Text} textNode
   * @returns {Element|null}
   */
  function findClickableAncestor (textNode) {
    var el = textNode.parentElement;
    var path = [];
    for (var i = 0; i < 8 && el; i++) {
      var tag = el.tagName.toLowerCase();
      var role = (el.getAttribute('role') || '').toLowerCase();
      path.push(tag + (role ? '[role=' + role + ']' : ''));
      if (tag === 'a' || tag === 'button' || role === 'button') {
        console.log('[QuickPost][DEBUG] findClickableAncestor ✅ found at depth', i, '| path:', path.join(' > '), '| el:', el);
        return el;
      }
      el = el.parentElement;
    }
    console.warn('[QuickPost][DEBUG] findClickableAncestor ❌ no clickable ancestor found | path traversed:', path.join(' > '), '| textNode:', JSON.stringify(textNode.nodeValue));
    return null;
  }

  /**
   * Walk up from the "View group" button element to find the group card.
   * We look for the first ancestor that contains AT LEAST ONE link to /groups/
   * AND contains the clickable element itself – i.e., the card wrapper.
   *
   * We use a "large enough container" heuristic: the card must be at least
   * 80px tall and contain a /groups/ href (the group title or thumbnail link).
   *
   * @param {Element} viewBtn
   * @returns {Element|null}
   */
  function findGroupCard (viewBtn) {
    var el = viewBtn.parentElement;
    for (var i = 0; i < 15 && el && el !== document.body; i++) {
      // The card will have at least one /groups/ anchor (name or thumbnail)
      var links = el.querySelectorAll('a[href*="/groups/"]');
      var h = el.offsetHeight;
      console.log('[QuickPost][DEBUG] findGroupCard step', i, '| tag:', el.tagName.toLowerCase(),
        '| /groups/ links:', links.length, '| offsetHeight:', h,
        el.id ? '| id:' + el.id : '',
        el.className ? '| class:' + String(el.className).slice(0, 60) : '');
      if (links.length >= 1 && h > 60) {
        console.log('[QuickPost][DEBUG] findGroupCard ✅ card found at depth', i, '| el:', el);
        return el;
      }
      el = el.parentElement;
    }
    console.warn('[QuickPost][DEBUG] findGroupCard ❌ no card found for viewBtn:', viewBtn);
    return null;
  }

  /** Parse group id from a Facebook /groups/<id>/ URL */
  function parseGroupIdFromUrl (url) {
    try {
      var pathname = new URL(url, location.href).pathname;
      var m = pathname.match(/^\/groups\/([^/?#]+)/);
      return m ? m[1] : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Extract the group ID from a card element.
   * Picks the FIRST /groups/<id>/ link whose id is NOT the reserved words
   * ("joins", "feed", "discover", "create", "search", "notifications").
   *
   * @param {Element} cardEl
   * @returns {string|null}
   */
  var GROUP_ID_SKIP = new Set(['joins', 'feed', 'discover', 'create', 'search', 'notifications', 'explore', 'join']);

  function extractGroupIdFromCard (cardEl) {
    var anchors = cardEl.querySelectorAll('a[href*="/groups/"]');
    for (var i = 0; i < anchors.length; i++) {
      var id = parseGroupIdFromUrl(anchors[i].href);
      if (id && !GROUP_ID_SKIP.has(id.toLowerCase())) return id;
    }
    return null;
  }

  function normalizeGroupName (text) {
    var name = (text || '').replace(/\s+/g, ' ').trim();
    if (!name) return '';

    if (VIEW_GROUP_TEXTS.has(name.toLowerCase())) return '';
    if (name.length > 120) return name.slice(0, 120);
    return name;
  }

  function extractGroupNameFromCard (cardEl, groupId) {
    var anchors = cardEl.querySelectorAll('a[href*="/groups/"]');
    for (var i = 0; i < anchors.length; i++) {
      var anchor = anchors[i];
      var id = parseGroupIdFromUrl(anchor.href);
      if (!id || GROUP_ID_SKIP.has(id.toLowerCase())) continue;
      if (id !== groupId) continue;

      var name = normalizeGroupName(anchor.textContent || anchor.getAttribute('aria-label') || '');
      if (name) return name;
    }

    return 'Group ' + groupId;
  }

  function getRandomIntInclusive (min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomizeUppercasePositions (text) {
    var chars = text.split('');
    var letterIndexes = [];

    for (var i = 0; i < chars.length; i++) {
      if (chars[i].toLowerCase() !== chars[i].toUpperCase()) {
        letterIndexes.push(i);
      }
    }

    if (letterIndexes.length === 0) return text;

    var maxUppercaseCount = Math.min(8, letterIndexes.length);
    var uppercaseCount = getRandomIntInclusive(1, maxUppercaseCount);

    for (var j = letterIndexes.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var temp = letterIndexes[j];
      letterIndexes[j] = letterIndexes[k];
      letterIndexes[k] = temp;
    }

    for (var n = 0; n < uppercaseCount; n++) {
      var idx = letterIndexes[n];
      chars[idx] = chars[idx].toUpperCase();
    }

    return chars.join('');
  }

  async function saveGroupToHistory (groupId, groupName) {
    try {
      await window.__QGP.Storage.upsertRecentGroup({
        id: groupId,
        name: groupName,
      });
    } catch (err) {
      console.warn('[QuickPost] Failed saving recent group:', err);
    }
  }

  async function performQuickPost (groupId, groupName) {
    await saveGroupToHistory(groupId, groupName || ('Group ' + groupId));

    await pageScriptsReady;

    var messageText = await window.__QGP.Storage.getActiveText();
    if (!messageText || !messageText.trim()) {
      throw new Error('No post content set. Open popup and enter post content first.');
    }

    var randomizedMessageText = randomizeUppercasePositions(messageText);
    var result = await triggerPost(groupId, randomizedMessageText);
    return result;
  }

  function sleep (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeDelayOptions (value) {
    const enabled = Boolean(value?.enabled);
    let minMs = Number(value?.minMs);
    let maxMs = Number(value?.maxMs);

    if (!Number.isFinite(minMs)) minMs = 2000;
    if (!Number.isFinite(maxMs)) maxMs = 6000;

    minMs = Math.max(0, Math.round(minMs));
    maxMs = Math.max(0, Math.round(maxMs));
    if (maxMs < minMs) {
      const temp = maxMs;
      maxMs = minMs;
      minMs = temp;
    }

    return { enabled, minMs, maxMs };
  }

  function getRandomDelayMs (minMs, maxMs) {
    if (maxMs <= minMs) return minMs;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }

  // ─── Injection Logic ─────────────────────────────────────────────────────────

  /**
   * Given the clickable "View group" element, find its card ancestor,
   * extract the group ID, and inject the "Quick post" button.
   *
   * @param {Element} viewBtn
   */
  function injectNextTo (viewBtn) {
    // Mark the button itself so we don't process it again
    if (viewBtn.hasAttribute(INJECTED_ATTR + '-processed')) return;
    viewBtn.setAttribute(INJECTED_ATTR + '-processed', '1');

    console.log('[QuickPost][DEBUG] injectNextTo: viewBtn tag=', viewBtn.tagName, 'text=', JSON.stringify((viewBtn.textContent || '').trim().slice(0, 60)));

    var card = findGroupCard(viewBtn);
    if (!card) {
      console.warn('[QuickPost][DEBUG] injectNextTo ❌ Could not find card for viewBtn:', viewBtn);
      return;
    }
    console.log('[QuickPost][DEBUG] injectNextTo: card found:', card.tagName, '| offsetHeight:', card.offsetHeight);

    // Skip card if we already injected a button into it
    if (card.querySelector('[' + INJECTED_ATTR + ']')) {
      console.log('[QuickPost][DEBUG] injectNextTo: button already injected in this card, skipping.');
      return;
    }

    var groupId = extractGroupIdFromCard(card);
    if (!groupId) {
      console.warn('[QuickPost][DEBUG] injectNextTo ❌ Could not get group ID from card:', card);
      // Log all /groups/ hrefs found in card for diagnosis
      var anchors = card.querySelectorAll('a[href*="/groups/"]');
      var hrefs = [];
      for (var ai = 0; ai < anchors.length; ai++) hrefs.push(anchors[ai].href);
      console.warn('[QuickPost][DEBUG] /groups/ hrefs in card:', hrefs);
      return;
    }
    console.log('[QuickPost][DEBUG] injectNextTo: groupId extracted:', groupId);

    // Sanity: numeric IDs should be ≥ 5 digits
    if (/^\d+$/.test(groupId) && groupId.length < 5) {
      console.warn('[QuickPost][DEBUG] injectNextTo: groupId', groupId, 'is numeric but too short, skipping.');
      return;
    }

    var groupName = extractGroupNameFromCard(card, groupId);
    var qBtn = createQuickPostButton(groupId, groupName);
    var parent = viewBtn.parentElement;
    if (!parent) {
      console.warn('[QuickPost][DEBUG] injectNextTo: viewBtn has no parentElement, skipping.');
      return;
    }

    // Insert immediately after the "View group" button
    var nextSib = viewBtn.nextSibling;
    if (nextSib) {
      parent.insertBefore(qBtn, nextSib);
    } else {
      parent.appendChild(qBtn);
    }

    console.log('[QuickPost] ✅ Injected Quick Post button for group:', groupId);
  }

  /**
   * Use a TreeWalker to find ALL text nodes whose trimmed content matches
   * one of the known "View group" strings.  This is the most reliable way
   * to locate the button deep inside Facebook's Comet component tree without
   * relying on specific class names or element types.
   */
  function scanAndInject () {
    console.log('[QuickPost][DEBUG] scanAndInject() called — looking for VIEW_GROUP_TEXTS:', [...VIEW_GROUP_TEXTS]);

    // ── Extra diagnostic: dump first 20 unique trimmed text values of all
    //    <a href*="/groups/"> elements so we can see what Facebook labels them now.
    var groupAnchors = document.body.querySelectorAll('a[href*="/groups/"]');
    var anchorTexts = new Set();
    for (var ai = 0; ai < groupAnchors.length && anchorTexts.size < 20; ai++) {
      var txt = (groupAnchors[ai].textContent || '').trim();
      if (txt) anchorTexts.add(txt);
    }
    console.log('[QuickPost][DEBUG] Sample text content of a[href*="/groups/"] on page (up to 20):',
      [...anchorTexts]);

    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          var t = (node.nodeValue || '').trim().toLowerCase();
          // Skip text from our own injected buttons
          if (node.parentElement && node.parentElement.hasAttribute(INJECTED_ATTR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return VIEW_GROUP_TEXTS.has(t)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) textNodes.push(n);

    console.log('[QuickPost][DEBUG] scanAndInject: matched text nodes count:', textNodes.length);

    if (textNodes.length === 0) {
      // Dump all distinct short text values from group-related elements to help find new button label
      var candidates = document.body.querySelectorAll('div[role="button"], a[role="button"], button');
      var candidateTexts = new Set();
      for (var ci = 0; ci < candidates.length && candidateTexts.size < 30; ci++) {
        var ct = (candidates[ci].textContent || '').trim();
        if (ct && ct.length < 40) candidateTexts.add(ct);
      }
      console.warn('[QuickPost][DEBUG] No VIEW_GROUP_TEXTS nodes found. Button/link texts on page (up to 30):',
        [...candidateTexts]);
    }

    for (var i = 0; i < textNodes.length; i++) {
      var textNode = textNodes[i];
      console.log('[QuickPost][DEBUG] Processing text node', i, ':', JSON.stringify(textNode.nodeValue));
      var clickable = findClickableAncestor(textNode);
      if (clickable) {
        injectNextTo(clickable);
      } else {
        console.warn('[QuickPost][DEBUG] Skipping text node', i, '— no clickable ancestor found');
      }
    }
  }

  // ─── Button Factory ──────────────────────────────────────────────────────────

  function createQuickPostButton (groupId, groupName) {
    var btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute(INJECTED_ATTR, 'true');
    btn.setAttribute('data-qgp-group-id', groupId);
    btn.textContent = 'Quick post';

    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '36px',
      marginLeft: '8px',
      padding: '0 12px',
      borderRadius: '6px',
      background: '#e4e6eb',
      color: '#050505',
      fontSize: '15px',
      fontWeight: '600',
      fontFamily: 'inherit',
      cursor: 'pointer',
      flexShrink: '0',
      userSelect: 'none',
      transition: 'background 0.1s',
      lineHeight: '1',
      whiteSpace: 'nowrap',
    });

    btn.addEventListener('mouseenter', function () {
      if (!btn.dataset.qgpBusy) btn.style.background = '#d8dadf';
    });
    btn.addEventListener('mouseleave', function () {
      if (!btn.dataset.qgpBusy) btn.style.background = '#e4e6eb';
    });

    function setLoading (loading) {
      btn.dataset.qgpBusy = loading ? '1' : '';
      btn.style.opacity = loading ? '0.6' : '1';
      btn.style.cursor = loading ? 'not-allowed' : 'pointer';
      btn.textContent = loading ? 'Posting\u2026' : 'Quick post';
    }

    function setSuccess () {
      btn.textContent = '\u2713 Posted!';
      btn.style.background = '#42b72a';
      btn.style.color = '#fff';
      btn.style.opacity = '1';
      btn.style.cursor = 'default';
      btn.dataset.qgpBusy = '';
      setTimeout(reset, 3000);
    }

    function setError () {
      btn.textContent = '\u2717 Failed';
      btn.style.background = '#fa383e';
      btn.style.color = '#fff';
      btn.style.opacity = '1';
      btn.style.cursor = 'default';
      btn.dataset.qgpBusy = '';
      setTimeout(reset, 3000);
    }

    function reset () {
      btn.textContent = 'Quick post';
      btn.style.background = '#e4e6eb';
      btn.style.color = '#050505';
      btn.style.cursor = 'pointer';
      btn.dataset.qgpBusy = '';
    }

    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      e.stopPropagation();

      if (btn.dataset.qgpBusy) return;

      console.log('[QuickPost] 🖱️ Quick post clicked for group:', groupId);
      setLoading(true);

      try {
        await performQuickPost(groupId, groupName);
        console.log('[QuickPost] ✅ Post succeeded! Group:', groupId);
        setSuccess();
      } catch (err) {
        console.error('[QuickPost] ❌ Post failed for group', groupId, '→', err.message);
        setError();
      }
    });

    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });

    return btn;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.action !== 'qgp-post-multi') return;

    const groups = Array.isArray(message.groups) ? message.groups : [];
    if (groups.length === 0) {
      sendResponse({ ok: false, error: 'No groups selected' });
      return;
    }

    (async () => {
      const results = [];
      const delayOptions = normalizeDelayOptions(message.delayOptions);

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const groupId = String(group.id || '').trim();
        const groupName = String(group.name || '').trim() || ('Group ' + groupId);

        if (!groupId) {
          results.push({ ok: false, groupId: '', groupName, error: 'Missing group id' });
          continue;
        }

        try {
          const result = await performQuickPost(groupId, groupName);
          results.push({
            ok: true,
            groupId,
            groupName,
            postId: result.postId,
          });
        } catch (err) {
          results.push({
            ok: false,
            groupId,
            groupName,
            error: err.message || 'Unknown post error',
          });
        }

        const isLastGroup = i === groups.length - 1;
        if (!isLastGroup && delayOptions.enabled) {
          const waitMs = getRandomDelayMs(delayOptions.minMs, delayOptions.maxMs);
          await sleep(waitMs);
        }
      }

      sendResponse({
        ok: true,
        results,
      });
    })().catch((err) => {
      sendResponse({ ok: false, error: err.message || 'Failed to post selected groups' });
    });

    return true;
  });

  // ─── MutationObserver ────────────────────────────────────────────────────────

  var scanTimer = null;

  var observer = new MutationObserver(function (mutations) {
    var hasAdditions = mutations.some(function (m) { return m.addedNodes.length > 0; });
    if (hasAdditions) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(function () {
        console.log('[QuickPost][DEBUG] MutationObserver triggered scanAndInject (debounced 300 ms)');
        scanAndInject();
      }, 300);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan — page may already have content at document_idle
  console.log('[QuickPost][DEBUG] Running initial scanAndInject…');
  scanAndInject();

  console.log('[QuickPost] injectButtons.js ready — observing DOM (ISOLATED world).');
})();
