/**
 * popup/popup.js
 *
 * Popup features:
 *   1. "Post Content" — textarea persisted to activeText in storage.
 *   2. "Recent Groups" — choose groups and run bulk posting.
 *
 * Depends on: shared/storage.js → window.__QGP.Storage
 */

(function () {
  'use strict';

  const Storage = window.__QGP.Storage;

  // ─── DOM refs ────────────────────────────────────────────────────────────────

  const activeTextEl = document.getElementById('activeText');
  const saveHint = document.getElementById('saveHint');
  const groupList = document.getElementById('groupList');
  const groupEmptyHint = document.getElementById('groupEmptyHint');
  const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
  const selectAllGroupsBtn = document.getElementById('selectAllGroupsBtn');
  const clearSelectedGroupsBtn = document.getElementById('clearSelectedGroupsBtn');
  const postSelectedBtn = document.getElementById('postSelectedBtn');
  const groupStatus = document.getElementById('groupStatus');
  const enableRandomDelayEl = document.getElementById('enableRandomDelay');
  const delayMinSecEl = document.getElementById('delayMinSec');
  const delayMaxSecEl = document.getElementById('delayMaxSec');

  // ─── State ───────────────────────────────────────────────────────────────────

  /** @type {{ id: string, name: string, lastPostedAt: number }[]} */
  let recentGroups = [];

  /** @type {Set<string>} */
  let selectedGroupIds = new Set();

  /** @type {{ enabled:boolean, minMs:number, maxMs:number }} */
  let bulkPostDelay = {
    enabled: false,
    minMs: 2000,
    maxMs: 6000,
  };

  /** Debounce timer for auto-saving activeText */
  let saveTimer = null;

  // ─── Boot ────────────────────────────────────────────────────────────────────

  async function init () {
    const data = await Storage.getAll();
    recentGroups = sortRecentGroups(data.recentGroups);
    selectedGroupIds = new Set(data.selectedGroupIds || []);
    bulkPostDelay = normalizeDelaySettings(data.bulkPostDelay);
    activeTextEl.value = data.activeText ?? '';
    renderGroupList();
    renderDelaySettings();
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  function renderGroupList () {
    groupList.innerHTML = '';

    if (recentGroups.length === 0) {
      groupEmptyHint.hidden = false;
      postSelectedBtn.disabled = true;
      return;
    }

    groupEmptyHint.hidden = true;

    for (const group of recentGroups) {
      const li = document.createElement('li');
      li.className = 'group-item';
      li.dataset.id = group.id;

      const isChecked = selectedGroupIds.has(group.id);
      const safeName = escHtml(group.name || `Group ${group.id}`);
      const safeId = escHtml(group.id);

      li.innerHTML = `
        <label class="group-item__label">
          <input type="checkbox" class="group-item__checkbox" data-group-id="${safeId}" ${isChecked ? 'checked' : ''} />
          <span class="group-item__info">
            <span class="group-item__name">${safeName}</span>
            <span class="group-item__meta">ID: ${safeId}</span>
          </span>
          <span class="group-item__time">${formatLastPosted(group.lastPostedAt)}</span>
        </label>
      `;

      const checkbox = li.querySelector('.group-item__checkbox');
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) selectedGroupIds.add(group.id);
        else selectedGroupIds.delete(group.id);

        await persistSelectedGroups();
        updateGroupActionsState();
      });

      groupList.appendChild(li);
    }

    updateGroupActionsState();
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  /** Debounced save of the active textarea to storage. */
  function scheduleSave () {
    clearTimeout(saveTimer);
    saveHint.textContent = '';
    saveTimer = setTimeout(async () => {
      await Storage.setActiveText(activeTextEl.value);
      saveHint.textContent = '\u2713 Saved';
      setTimeout(() => (saveHint.textContent = ''), 1600);
    }, 600);
  }

  async function persistSelectedGroups () {
    await Storage.setSelectedGroupIds([...selectedGroupIds]);
  }

  function updateGroupActionsState () {
    const selectedCount = selectedGroupIds.size;
    postSelectedBtn.disabled = selectedCount === 0;
    postSelectedBtn.textContent = selectedCount > 0
      ? `Post to selected groups (${selectedCount})`
      : 'Post to selected groups';
  }

  async function handleSelectAllGroups () {
    selectedGroupIds = new Set(recentGroups.map((g) => g.id));
    await persistSelectedGroups();
    renderGroupList();
  }

  async function handleClearSelectedGroups () {
    selectedGroupIds = new Set();
    await persistSelectedGroups();
    renderGroupList();
  }

  async function refreshGroupsFromStorage () {
    const data = await Storage.getAll();
    recentGroups = sortRecentGroups(data.recentGroups);
    selectedGroupIds = new Set(data.selectedGroupIds || []);
    bulkPostDelay = normalizeDelaySettings(data.bulkPostDelay);
    renderGroupList();
    renderDelaySettings();
  }

  async function handlePostSelectedGroups () {
    const selectedGroups = recentGroups.filter((g) => selectedGroupIds.has(g.id));
    if (selectedGroups.length === 0) {
      groupStatus.textContent = 'Hay chon it nhat 1 group.';
      return;
    }

    groupStatus.textContent = 'Dang post...';
    postSelectedBtn.disabled = true;

    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error('Khong tim thay tab dang active');

      // Kiểm tra xem tab hiện tại có phải là Facebook groups page
      const isGroupsPage = tab.url && (
        tab.url.includes('facebook.com/groups/') ||
        tab.url.includes('web.facebook.com/groups/')
      );
      if (!isGroupsPage) {
        throw new Error('Vui lòng mở Facebook Groups page (facebook.com/groups/) để post');
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'qgp-post-multi',
        groups: selectedGroups,
        delayOptions: normalizeDelaySettings(bulkPostDelay),
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Khong the post tren tab hien tai');
      }

      const results = response.results || [];
      const successCount = results.filter((r) => r.ok).length;
      const failCount = results.length - successCount;

      if (failCount === 0) {
        groupStatus.textContent = `Thanh cong ${successCount}/${results.length} groups.`;
      } else {
        const firstFail = results.find((r) => !r.ok);
        groupStatus.textContent = `Thanh cong ${successCount}/${results.length}, that bai ${failCount}. ${firstFail?.groupName || ''}: ${firstFail?.error || ''}`.trim();
      }

      await refreshGroupsFromStorage();
    } catch (err) {
      groupStatus.textContent = err.message || 'Co loi khi post cac group da chon.';
    } finally {
      updateGroupActionsState();
    }
  }

  async function getActiveTab () {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function sortRecentGroups (groups) {
    return [...(groups || [])].sort((a, b) => (b.lastPostedAt || 0) - (a.lastPostedAt || 0));
  }

  function normalizeDelaySettings (value) {
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

  function renderDelaySettings () {
    const normalized = normalizeDelaySettings(bulkPostDelay);
    bulkPostDelay = normalized;

    enableRandomDelayEl.checked = normalized.enabled;
    delayMinSecEl.value = String(Math.round(normalized.minMs / 1000));
    delayMaxSecEl.value = String(Math.round(normalized.maxMs / 1000));

    delayMinSecEl.disabled = !normalized.enabled;
    delayMaxSecEl.disabled = !normalized.enabled;
  }

  async function persistDelaySettingsFromInputs () {
    const enabled = enableRandomDelayEl.checked;
    const minSec = Number(delayMinSecEl.value || 0);
    const maxSec = Number(delayMaxSecEl.value || 0);

    let minMs = Number.isFinite(minSec) ? minSec * 1000 : 2000;
    let maxMs = Number.isFinite(maxSec) ? maxSec * 1000 : 6000;

    minMs = Math.max(0, Math.round(minMs));
    maxMs = Math.max(0, Math.round(maxMs));
    if (maxMs < minMs) {
      const temp = maxMs;
      maxMs = minMs;
      minMs = temp;
    }

    bulkPostDelay = { enabled, minMs, maxMs };
    await Storage.setBulkPostDelay(bulkPostDelay);
    renderDelaySettings();
  }

  function formatLastPosted (ts) {
    if (!ts) return '-';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  function escHtml (str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  activeTextEl.addEventListener('input', scheduleSave);

  refreshGroupsBtn.addEventListener('click', refreshGroupsFromStorage);
  selectAllGroupsBtn.addEventListener('click', handleSelectAllGroups);
  clearSelectedGroupsBtn.addEventListener('click', handleClearSelectedGroups);
  postSelectedBtn.addEventListener('click', handlePostSelectedGroups);
  enableRandomDelayEl.addEventListener('change', persistDelaySettingsFromInputs);
  delayMinSecEl.addEventListener('change', persistDelaySettingsFromInputs);
  delayMaxSecEl.addEventListener('change', persistDelaySettingsFromInputs);

  // React to storage changes from other contexts
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    const data = await Storage.getAll();
    recentGroups = sortRecentGroups(data.recentGroups);
    selectedGroupIds = new Set(data.selectedGroupIds || []);
    bulkPostDelay = normalizeDelaySettings(data.bulkPostDelay);
    renderGroupList();
    renderDelaySettings();
  });

  // ─── Init ────────────────────────────────────────────────────────────────────

  init();
})();
