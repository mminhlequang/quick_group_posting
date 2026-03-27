/**
 * shared/storage.js
 *
 * Thin wrapper around chrome.storage.local.
 *
 * Schema:
 *   {
 *     activeText: string,
 *     recentGroups: Array<{ id: string, name: string, lastPostedAt: number }>,
 *     selectedGroupIds: Array<string>,
 *     bulkPostDelay: { enabled: boolean, minMs: number, maxMs: number }
 *   }
 *
 * Loaded by:
 *   - popup/popup.html (via <script>)
 *   - content scripts (manifest content_scripts array)
 */

window.__QGP = window.__QGP || {};

const DEFAULT_BULK_POST_DELAY = {
  enabled: false,
  minMs: 2000,
  maxMs: 6000,
};

const Storage = {

  // ─── Read ──────────────────────────────────────────────────────────────────

  /**
   * Returns the full storage snapshot.
   * @returns {Promise<{ activeText: string, recentGroups: Array, selectedGroupIds: Array, bulkPostDelay: object }>}
   */
  async getAll () {
    return chrome.storage.local.get(['activeText', 'recentGroups', 'selectedGroupIds', 'bulkPostDelay']).then(
      (data) => ({
        activeText: data.activeText ?? '',
        recentGroups: data.recentGroups ?? [],
        selectedGroupIds: data.selectedGroupIds ?? [],
        bulkPostDelay: {
          ...DEFAULT_BULK_POST_DELAY,
          ...(data.bulkPostDelay ?? {}),
        },
      })
    );
  },

  /**
   * Returns the active post text (the textarea content).
   * @returns {Promise<string>}
   */
  async getActiveText () {
    const { activeText } = await Storage.getAll();
    return activeText;
  },

  /**
   * Returns recent posted groups.
   * @returns {Promise<Array<{ id:string, name:string, lastPostedAt:number }>>}
   */
  async getRecentGroups () {
    const { recentGroups } = await Storage.getAll();
    return recentGroups;
  },

  /**
   * Returns selected group IDs from popup selector.
   * @returns {Promise<Array<string>>}
   */
  async getSelectedGroupIds () {
    const { selectedGroupIds } = await Storage.getAll();
    return selectedGroupIds;
  },

  /**
   * Returns bulk posting random-delay settings.
   * @returns {Promise<{ enabled:boolean, minMs:number, maxMs:number }>}
   */
  async getBulkPostDelay () {
    const { bulkPostDelay } = await Storage.getAll();
    return bulkPostDelay;
  },

  // ─── Write ─────────────────────────────────────────────────────────────────

  /**
   * Persist the active post text.
   * @param {string} text
   */
  async setActiveText (text) {
    await chrome.storage.local.set({ activeText: text });
  },

  /**
   * Persist recent groups list.
   * @param {Array<{ id:string, name:string, lastPostedAt:number }>} recentGroups
   */
  async saveRecentGroups (recentGroups) {
    await chrome.storage.local.set({ recentGroups });
  },

  /**
   * Persist selected group ids.
   * @param {Array<string>} selectedGroupIds
   */
  async setSelectedGroupIds (selectedGroupIds) {
    await chrome.storage.local.set({ selectedGroupIds });
  },

  /**
   * Persist bulk post random delay settings.
   * @param {{ enabled?:boolean, minMs?:number, maxMs?:number }} delay
   */
  async setBulkPostDelay (delay) {
    const current = await Storage.getBulkPostDelay();

    const enabled = Boolean(delay?.enabled);
    let minMs = Number(delay?.minMs);
    let maxMs = Number(delay?.maxMs);

    if (!Number.isFinite(minMs)) minMs = current.minMs;
    if (!Number.isFinite(maxMs)) maxMs = current.maxMs;

    minMs = Math.max(0, Math.round(minMs));
    maxMs = Math.max(0, Math.round(maxMs));
    if (maxMs < minMs) {
      const temp = maxMs;
      maxMs = minMs;
      minMs = temp;
    }

    await chrome.storage.local.set({
      bulkPostDelay: { enabled, minMs, maxMs },
    });
  },

  /**
   * Add/update a group in recent list and keep it sorted by latest post time.
   * @param {{ id:string, name?:string, lastPostedAt?:number }} group
   */
  async upsertRecentGroup ({ id, name, lastPostedAt }) {
    if (!id) throw new Error('Group id is required');

    const groups = await Storage.getRecentGroups();
    const postedAt = Number(lastPostedAt) || Date.now();
    const idx = groups.findIndex((g) => g.id === id);

    if (idx !== -1) {
      groups[idx] = {
        ...groups[idx],
        name: name || groups[idx].name || id,
        lastPostedAt: postedAt,
      };
    } else {
      groups.push({
        id,
        name: name || id,
        lastPostedAt: postedAt,
      });
    }

    groups.sort((a, b) => (b.lastPostedAt || 0) - (a.lastPostedAt || 0));
    await Storage.saveRecentGroups(groups.slice(0, 200));
  },
};

window.__QGP.Storage = Storage;
