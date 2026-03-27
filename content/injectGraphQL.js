/**
 * content/injectGraphQL.js
 *
 * Runs in MAIN world (page JS context), injected via <script src> by
 * injectButtons.js (ISOLATED world).
 *
 * Responsibilities:
 *   1. Listen for QGP_REQUEST messages from the ISOLATED world
 *   2. Execute Facebook's ComposerStoryCreateMutation via fetch()
 *   3. Reply with QGP_RESULT message
 *
 * Uses credentials:'include' so existing session cookies are sent automatically.
 * No cookies are set manually.
 */

window.__QGP = window.__QGP || {};

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * doc_id for ComposerStoryCreateMutation.
 * Verify in DevTools → Network → filter "graphql" → find ComposerStoryCreateMutation
 * → look at the request body for doc_id.
 */
const COMPOSER_DOC_ID = '34112687938376332';

// Use current origin so it works on both www.facebook.com and web.facebook.com
const GRAPHQL_URL = location.origin + '/api/graphql/';

// ─── jazoest helper ──────────────────────────────────────────────────────────

/**
 * Facebook derives jazoest from fb_dtsg by summing char codes and prepending "2".
 * Required by some Facebook API endpoints.
 * @param {string} fbDtsg
 * @returns {string}
 */
function calcJazoest (fbDtsg) {
  let sum = 0;
  for (let i = 0; i < fbDtsg.length; i++) sum += fbDtsg.charCodeAt(i);
  return '2' + sum;
}

// ─── Request Builder ─────────────────────────────────────────────────────────

/**
 * Build URLSearchParams body matching the real ComposerStoryCreateMutation
 * request captured from the browser.
 *
 * @param {object} p
 * @param {string} p.actorId
 * @param {string} p.groupId
 * @param {string} p.messageText
 * @param {string} p.fbDtsg
 * @param {string} p.lsd
 * @param {string|null} p.spinR   — __spin_r / __rev
 * @param {string|null} p.spinT   — __spin_t
 * @param {string} p.composerSessionId
 * @returns {URLSearchParams}
 */
function buildMutationParams ({ actorId, groupId, messageText, fbDtsg, lsd, spinR, spinT, composerSessionId }) {
  // ── variables ─────────────────────────────────────────────────────────────
  const variables = {
    input: {
      composer_entry_point: 'inline_composer',
      composer_source_surface: 'group',
      composer_type: 'group',

      // Composer session tracked by FB for analytics
      logging: { composer_session_id: composerSessionId },

      source: 'WWW',

      // Message payload — ranges required even when empty
      message: { ranges: [], text: messageText },

      with_tags_ids: null,
      inline_activities: [],
      text_format_preset_id: '206317411591834',
      group_flair: { flair_id: null },

      navigation_data: { attribution_id_v2: '' },
      tracking: [null],
      event_share_metadata: { surface: 'newsfeed' },

      // Target group + acting user
      audience: { to_id: groupId },
      actor_id: actorId,

      client_mutation_id: '1',
    },

    // Feed / render location metadata
    feedLocation: 'GROUP',
    feedbackSource: 0,
    focusCommentID: null,
    gridMediaWidth: null,
    groupID: null,
    scale: Math.round(window.devicePixelRatio) || 1,
    privacySelectorRenderLocation: 'COMET_STREAM',
    checkPhotosToReelsUpsellEligibility: false,
    referringStoryRenderLocation: null,
    renderLocation: 'group',
    useDefaultActor: false,
    inviteShortLinkKey: null,
    isFeed: false,
    isFundraiser: false,
    isFunFactPost: false,
    isGroup: true,
    isEvent: false,
    isTimeline: false,
    isSocialLearning: false,
    isPageNewsFeed: false,
    isProfileReviews: false,
    isWorkSharedDraft: false,
    hashtag: null,
    canUserManageOffers: false,

    // Relay provider flags (required by this doc_id version)
    '__relay_internal__pv__CometUFIShareActionMigrationrelayprovider': true,
    '__relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider': true,
    '__relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider': true,
    '__relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider': false,
    '__relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider': false,
    '__relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider': false,
    '__relay_internal__pv__IsWorkUserrelayprovider': false,
    '__relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider': false,
    '__relay_internal__pv__CometUFISingleLineUFIrelayprovider': false,
    '__relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider': false,
    '__relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider': true,
    '__relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider': true,
    '__relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider': false,
    '__relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider': false,
    '__relay_internal__pv__IsMergQAPollsrelayprovider': false,
    '__relay_internal__pv__FBReels_enable_meta_ai_label_gkrelayprovider': true,
    '__relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider': true,
    '__relay_internal__pv__StoriesArmadilloReplyEnabledrelayprovider': true,
    '__relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider': true,
    '__relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider': 206,
    '__relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider': false,
    '__relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider': false,
    '__relay_internal__pv__groups_comet_use_glvrelayprovider': false,
    '__relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider': true,
    '__relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider': false,
    '__relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider': true,
  };

  // ── body params ───────────────────────────────────────────────────────────
  const params = new URLSearchParams();

  // User identity
  params.set('av', actorId);
  params.set('__aaid', '0');
  params.set('__user', actorId);
  params.set('__a', '1');

  // Comet request metadata
  params.set('__comet_req', '15');
  params.set('fb_api_caller_class', 'RelayModern');
  params.set('fb_api_req_friendly_name', 'ComposerStoryCreateMutation');

  // Security tokens
  params.set('fb_dtsg', fbDtsg);
  params.set('jazoest', calcJazoest(fbDtsg));
  params.set('lsd', lsd);

  // Spin / revision
  if (spinR != null) {
    params.set('__spin_r', String(spinR));
    params.set('__rev', String(spinR));   // __rev mirrors __spin_r
  }
  params.set('__spin_b', 'trunk');
  if (spinT != null) params.set('__spin_t', String(spinT));

  // Route context
  params.set('__crn', 'comet.fbweb.CometGroupDiscussionRoute');

  // GraphQL operation
  params.set('variables', JSON.stringify(variables));
  params.set('doc_id', COMPOSER_DOC_ID);
  params.set('server_timestamps', 'true');

  return params;
}

// ─── Core Post Function ──────────────────────────────────────────────────────

async function postToGroup (groupId, messageText) {
  const Helpers = window.__QGP.Helpers;

  // Gather tokens
  const fbDtsg = Helpers.getFbDtsg();
  const lsd = Helpers.getLsd();
  const { spin_r: spinR, spin_t: spinT } = Helpers.getSpinTokens();
  const actorId = Helpers.getCurrentUserId();
  const composerSessionId = Helpers.generateComposerSessionId();

  console.log('[QuickPost][MAIN] Token check:', {
    fbDtsg: fbDtsg ? fbDtsg.slice(0, 12) + '…' : null,
    lsd: lsd ? lsd.slice(0, 12) + '…' : null,
    actorId, spinR, spinT, composerSessionId,
  });

  if (!fbDtsg) throw new Error('Missing fb_dtsg');
  if (!lsd) throw new Error('Missing lsd');
  if (!actorId) throw new Error('Missing actor_id');

  const body = buildMutationParams({ actorId, groupId, messageText, fbDtsg, lsd, spinR, spinT, composerSessionId });

  console.log('[QuickPost][MAIN] Sending fetch to', GRAPHQL_URL);
  console.log('[QuickPost][MAIN] Body preview:', body.toString().slice(0, 300) + '…');

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-FB-Friendly-Name': 'ComposerStoryCreateMutation',
      'X-FB-LSD': lsd,
      'X-ASBD-ID': '359341',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
    body: body.toString(),
  });

  console.log('[QuickPost][MAIN] HTTP status:', response.status, response.statusText);

  const rawText = await response.text();
  console.log('[QuickPost][MAIN] Raw response (first 500 chars):', rawText.slice(0, 500));

  const jsonText = rawText.replace(/^\)\]\}'\s*/, '');

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new Error('Failed to parse response: ' + rawText.slice(0, 200));
  }

  console.log('[QuickPost][MAIN] Parsed response:', JSON.stringify(data).slice(0, 600));

  if (data.errors && data.errors.length > 0) {
    const errMsg = data.errors.map((e) => e.message).join('; ');
    throw new Error('Facebook API error: ' + errMsg);
  }

  const storyCreate =
    data?.data?.story_create ??
    data?.data?.composerStoryCreate ??
    data?.data?.createComposerStory ??
    {};

  const postId =
    storyCreate?.story?.id ??
    storyCreate?.post?.id ??
    storyCreate?.result?.id ??
    'unknown';

  console.log('[QuickPost][MAIN] ✅ Posted to group', groupId, '| Post ID:', postId);
  return { postId, groupId };
}

// ─── QGP_REQUEST listener (ISOLATED → MAIN bridge) ───────────────────────────

/**
 * The ISOLATED world cannot call postToGroup() directly (different JS context).
 * Instead it sends a QGP_REQUEST message; we handle it here in MAIN world and
 * reply with QGP_RESULT.  This avoids inline <script> injection which is
 * blocked by Facebook's Content Security Policy.
 */
window.addEventListener('message', async function (event) {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'QGP_REQUEST') return;

  const { requestId, groupId, messageText } = msg;
  console.log('[QuickPost][MAIN] 📥 Received QGP_REQUEST:', { requestId, groupId, preview: messageText.slice(0, 60) });

  try {
    const result = await postToGroup(groupId, messageText);
    window.postMessage({
      source: 'QGP_RESULT',
      requestId,
      ok: true,
      postId: result.postId,
      groupId,
    }, '*');
  } catch (err) {
    console.error('[QuickPost][MAIN] ❌ postToGroup threw:', err);
    window.postMessage({
      source: 'QGP_RESULT',
      requestId,
      ok: false,
      error: err.message,
    }, '*');
  }
});

// ─── Export ──────────────────────────────────────────────────────────────────

window.__QGP.GraphQL = { postToGroup, buildMutationParams };

console.log('[QuickPost][MAIN] injectGraphQL.js loaded — QGP_REQUEST listener active.');

