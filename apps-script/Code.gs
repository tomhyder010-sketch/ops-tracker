/**
 * Ops Tracker backend — lives inside the Google Sheet.
 *
 * Setup (once, ~3 min):
 *   1. Create a blank Google Sheet (sheets.new). Name it e.g. "Ops Tracker".
 *   2. Extensions → Apps Script, delete any code there, paste this file.
 *   3. Deploy → New deployment → type "Web app"
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the Web app URL (ends in /exec) — that's the backend URL. Paste
 *      it into API_URL in src/lib/api.ts (or run, without rebuilding:
 *      localStorage.setItem('ops_api_url', 'https://…/exec')).
 *
 * The script creates two tabs automatically:
 *   Calls    — one row per booked call
 *   Clients  — one row per client
 *
 * If you edit this file later, redeploy: Deploy → Manage deployments →
 * edit (pencil) → Version: New version, so the same /exec URL keeps working.
 */

var CALL_HEADERS = [
  "id", "start_time", "booked_at", "invitee_name", "invitee_email",
  "invitee_phone", "source", "event_type", "campaign", "status", "value",
  "is_duplicate", "notes", "created_at", "updated_at",
  // Added later — appended at the end so existing rows/columns don't shift.
  // Raw utm_source value, which is what Tom's ad setup actually uses to
  // carry the Meta *campaign* name (utm_campaign holds a different, broader
  // label) — this is the join key against Meta Campaigns.campaign_name.
  "meta_campaign_name",
  // Invitee's location — derived from Calendly's timezone field (the only
  // per-lead location signal actually available; Meta's geo breakdowns are
  // aggregate/per-campaign, not per-lead).
  "location",
  // Follow-up temperature (Warm/Cold/Lost) — a tag independent of the
  // Booked/Shown/Closed pipeline status, e.g. a call can be "Shown" AND
  // "Warm" at the same time.
  "temperature",
  // Whether the prospect was actually qualified on the call — feeds
  // "Cost per Qualified Call" on the Ad Campaigns tab.
  "qualified",
  // Raw utm_content — Tom's ad names ("AD 1 - 07/08/26 - Wasting Leads")
  // live here, matching Meta's ad_name field exactly. Join key against
  // Ads.ad_name, same idea as meta_campaign_name/campaign_name.
  "meta_ad_name"
];

var CALL_NUMBER_FIELDS = ["value"];
var CALL_BOOLEAN_FIELDS = ["is_duplicate"];

var CLIENT_HEADERS = [
  "id", "name", "contact_name", "status", "deal_value", "monthly_value",
  "cash_collected", "start_date", "churn_date", "notes", "created_at",
  "updated_at"
];

var CLIENT_NUMBER_FIELDS = ["deal_value", "monthly_value", "cash_collected"];

// One row per application/questionnaire submission from the Lovable app —
// pushed live via a Supabase Database Webhook (pg_net trigger) on every
// INSERT into questionnaire_submissions. "id" is that row's own Supabase
// UUID, so a retry updates in place instead of duplicating. "answers" is
// the full question->answer JSON, stored as a string (Sheets cells are
// text/number only) and parsed back out on the frontend.
var LEAD_HEADERS = [
  "id", "questionnaire_id", "name", "email", "answers", "created_at", "updated_at",
  // Derived from whatever phone number is in their answers — see
  // deriveLocationFromPhone_.
  "location"
];
var LEAD_NUMBER_FIELDS = [];

// One row per Meta campaign, refreshed on a schedule (see
// installMetaSyncTrigger_ below) — a rolling last-30-day snapshot, not a
// historical time series.
var CAMPAIGN_HEADERS = [
  "campaign_name", "spend", "impressions", "reach", "clicks", "link_clicks",
  "ctr", "link_ctr", "cpm", "cost_per_link_click",
  "leads", "cost_per_lead", "landing_page_views",
  "video_plays", "video_p25", "video_p50", "video_p75", "video_p95", "video_p100",
  "thruplays", "video_avg_watch_seconds", "hook_rate", "hold_rate_50",
  "updated_at"
];
var CAMPAIGN_NUMBER_FIELDS = [
  "spend", "impressions", "reach", "clicks", "link_clicks",
  "ctr", "link_ctr", "cpm", "cost_per_link_click",
  "leads", "cost_per_lead", "landing_page_views",
  "video_plays", "video_p25", "video_p50", "video_p75", "video_p95", "video_p100",
  "thruplays", "video_avg_watch_seconds", "hook_rate", "hold_rate_50"
];

// One row per active ad (creative), same shape as Campaigns but keyed by
// ad_id (unique; ad_name alone isn't guaranteed unique across campaigns).
var AD_HEADERS = [
  "ad_id", "ad_name", "campaign_name", "spend", "impressions", "reach", "clicks", "link_clicks",
  "ctr", "link_ctr", "cpm", "cost_per_link_click",
  "leads", "cost_per_lead", "landing_page_views",
  "video_plays", "video_p25", "video_p50", "video_p75", "video_p95", "video_p100",
  "thruplays", "video_avg_watch_seconds", "hook_rate", "hold_rate_50",
  "updated_at"
];
var AD_NUMBER_FIELDS = CAMPAIGN_NUMBER_FIELDS;

var META_AD_ACCOUNT_ID = "act_537574055821730"; // "Systemised Scaling" — not a secret, just an id

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Self-healing migration: if `headers` has grown since this sheet was
  // created (e.g. a new column added in code later), append the missing
  // header labels to the existing header row rather than requiring a
  // manual Sheet edit. Never reorders/removes existing columns.
  var existingWidth = sheet.getLastColumn();
  if (existingWidth < headers.length) {
    var missing = headers.slice(existingWidth);
    sheet.getRange(1, existingWidth + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function asDateString_(value) {
  if (value && typeof value.getTime === "function") {
    return new Date(value.getTime()).toISOString();
  }
  return String(value == null ? "" : value);
}

// Compares two timestamps by parsed instant rather than raw string, since
// the same moment can arrive as differently-formatted ISO strings (Sheets
// normalizes to "…00.000Z", Calendly's webhook payload sends
// "…00.000000Z" with microseconds) — a straight string compare would treat
// those as different and defeat the webhook dedupe below.
function sameInstant_(a, b) {
  if (!a || !b) return false;
  var ta = new Date(a).getTime();
  var tb = new Date(b).getTime();
  if (isNaN(ta) || isNaN(tb)) return String(a) === String(b);
  return ta === tb;
}

// Reads every data row of `sheet` into an array of objects keyed by
// `headers`, coercing numberFields to Number and booleanFields to Boolean;
// everything else stays a string.
function readRows_(sheet, headers, numberFields, booleanFields) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(function (row) { return String(row[0]).trim() !== ""; })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (header, i) {
        if (numberFields.indexOf(header) !== -1) {
          obj[header] = Number(row[i]) || 0;
        } else if (booleanFields && booleanFields.indexOf(header) !== -1) {
          obj[header] = row[i] === true || String(row[i]).toLowerCase() === "true";
        } else {
          obj[header] = asDateString_(row[i]);
        }
      });
      return obj;
    });
}

function findRowIndexById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// Upserts `data` (a plain object) into `sheet` by `data.id`. Generates a new
// id + created_at when absent, always refreshes updated_at. Returns the
// saved row as an object.
function upsertRow_(sheet, headers, numberFields, booleanFields, data) {
  var now = new Date().toISOString();
  var existingRowIndex = data.id ? findRowIndexById_(sheet, data.id) : -1;
  var isUpdate = existingRowIndex > 0;

  var id = data.id || Utilities.getUuid();
  var created_at = data.created_at || now;
  if (isUpdate) {
    var existingValues = sheet.getRange(existingRowIndex, 1, 1, headers.length).getValues()[0];
    var createdIdx = headers.indexOf("created_at");
    if (createdIdx !== -1 && existingValues[createdIdx]) {
      created_at = asDateString_(existingValues[createdIdx]);
    }
  }

  var merged = {};
  headers.forEach(function (h) { merged[h] = data[h]; });
  merged.id = id;
  merged.created_at = created_at;
  merged.updated_at = now;

  var row = headers.map(function (header) {
    var value = merged[header];
    if (numberFields.indexOf(header) !== -1) return Number(value) || 0;
    if (booleanFields && booleanFields.indexOf(header) !== -1) return value === true;
    return value == null ? "" : String(value);
  });

  // Text columns get an explicit "plain text" format before writing —
  // otherwise Sheets tries to parse values starting with "+" (phone
  // numbers like "+1 555…") or "=" as formulas and stores "#ERROR!"
  // instead of the actual value.
  var formats = headers.map(function (header) {
    if (numberFields.indexOf(header) !== -1) return "General";
    if (booleanFields && booleanFields.indexOf(header) !== -1) return "General";
    return "@";
  });

  var targetRow = isUpdate ? existingRowIndex : sheet.getLastRow() + 1;
  var range = sheet.getRange(targetRow, 1, 1, headers.length);
  range.setNumberFormats([formats]);
  range.setValues([row]);
  return merged;
}

function deleteRowById_(sheet, id) {
  var rowIndex = findRowIndexById_(sheet, id);
  if (rowIndex > 0) sheet.deleteRow(rowIndex);
  return { ok: true };
}

function doGet(e) {
  // Temporary escape hatch: the Apps Script editor's function picker (Run
  // dropdown / Triggers dialog) was stuck only listing doGet/doPost, so
  // this reuses doGet itself — the one function confirmed selectable — to
  // run the one-time Meta setup two different ways:
  //   - Editor "Run" button (e is undefined — a manual run has no request
  //     object): runs setup directly. This is the one that matters — an
  //     interactive Editor run is what triggers Google's "Authorization
  //     required" popup for the ScriptApp (trigger-management) scope,
  //     which a plain HTTP request can never show.
  //   - Visiting .../exec?run=meta_setup: same setup, kept as a fallback
  //     for re-running later without reopening the editor, once the scope
  //     above is already authorized.
  if (!e || (e.parameter && e.parameter.run === "meta_setup")) {
    try {
      setMetaToken_();
      installMetaSyncTrigger_();
      var result = { ok: true, message: "Token stored and trigger installed." };
      return e ? json_(result) : result; // manual runs don't need a web response
    } catch (err) {
      var failure = { ok: false, error: String(err) };
      if (e) return json_(failure);
      throw err; // surface it in the Editor's execution log for a manual run
    }
  }

  var callsSheet = getSheet_("Calls", CALL_HEADERS);
  var clientsSheet = getSheet_("Clients", CLIENT_HEADERS);
  var campaignsSheet = getSheet_("Campaigns", CAMPAIGN_HEADERS);
  var adsSheet = getSheet_("Ads", AD_HEADERS);
  var leadsSheet = getSheet_("Leads", LEAD_HEADERS);
  return json_({
    ok: true,
    calls: readRows_(callsSheet, CALL_HEADERS, CALL_NUMBER_FIELDS, CALL_BOOLEAN_FIELDS),
    clients: readRows_(clientsSheet, CLIENT_HEADERS, CLIENT_NUMBER_FIELDS, []),
    campaigns: readRows_(campaignsSheet, CAMPAIGN_HEADERS, CAMPAIGN_NUMBER_FIELDS, []),
    ads: readRows_(adsSheet, AD_HEADERS, AD_NUMBER_FIELDS, []),
    leads: readRows_(leadsSheet, LEAD_HEADERS, LEAD_NUMBER_FIELDS, []),
  });
}

// ---- Meta Ads -------------------------------------------------------------
//
// One-time setup (run these two from the Apps Script editor's function
// picker — top toolbar dropdown next to the Run button — not from doGet/
// doPost):
//   1. setMetaToken_() — paste your token into the placeholder below FIRST,
//      run it once, then delete the token from this file again (it's now
//      safely stored in this script's private PropertiesService, which
//      never appears in doGet's JSON output or in the Code.gs source you'd
//      copy/paste elsewhere).
//   2. installMetaSyncTrigger_() — run once to schedule fetchMetaInsights_
//      to run automatically every 6 hours. (Re-running it is safe — it
//      clears any previous trigger it created first.)
//
// After that, campaigns refresh on their own. The app can also POST
// {"action":"sync_meta_now"} for an on-demand refresh (e.g. a "Refresh"
// button), which calls the same function synchronously.

function setMetaToken_() {
  var token = "PASTE_YOUR_TOKEN_HERE";
  if (token === "PASTE_YOUR_TOKEN_HERE") {
    throw new Error("Edit this function: replace the placeholder with your real token first.");
  }
  PropertiesService.getScriptProperties().setProperty("META_ACCESS_TOKEN", token);
  Logger.log("Token stored.");
}

function installMetaSyncTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "fetchMetaInsights_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("fetchMetaInsights_").timeBased().everyHours(6).create();
  Logger.log("Trigger installed: fetchMetaInsights_ every 6 hours.");
}

// Looks up a value from Meta's "actions" / "cost_per_action_type" arrays
// (each entry shaped {action_type, value}) by action_type. Returns 0 if
// that action type didn't fire for this campaign in the period.
function findAction_(actions, type) {
  if (!actions) return 0;
  for (var i = 0; i < actions.length; i++) {
    if (actions[i].action_type === type) return Number(actions[i].value) || 0;
  }
  return 0;
}

// "Leads" for a lead-gen campaign can land under a few different
// action_types depending on how the pixel/form is set up — try the most
// specific first, fall back to broader ones.
var LEAD_ACTION_TYPES = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_web_lead"];

function findLeadAction_(actions) {
  for (var i = 0; i < LEAD_ACTION_TYPES.length; i++) {
    var v = findAction_(actions, LEAD_ACTION_TYPES[i]);
    if (v) return v;
  }
  return 0;
}

function findLeadCost_(costPerAction) {
  for (var i = 0; i < LEAD_ACTION_TYPES.length; i++) {
    var v = findAction_(costPerAction, LEAD_ACTION_TYPES[i]);
    if (v) return v;
  }
  return 0;
}

var META_INSIGHTS_FIELDS_ = [
  "spend", "impressions", "reach", "clicks", "inline_link_clicks",
  "ctr", "inline_link_click_ctr", "cpm", "cost_per_inline_link_click",
  "actions", "cost_per_action_type",
  "video_play_actions", "video_p25_watched_actions", "video_p50_watched_actions",
  "video_p75_watched_actions", "video_p95_watched_actions", "video_p100_watched_actions",
  "video_thruplay_watched_actions", "video_avg_time_watched_actions"
];

// Shared by campaign- and ad-level sync: turns one raw Marketing API
// insights row into the metrics object both Campaigns and Ads store —
// spend/reach/clicks, CTR/CPM, leads, landing page views, and the full
// video-retention funnel (plays, 25/50/75/95/100% watched, ThruPlays,
// average watch time). Doesn't include the identifying fields
// (campaign_name / ad_id / ad_name) — the caller adds those.
function parseInsightsMetrics_(row) {
  var videoPlays = findAction_(row.video_play_actions, "video_view");
  var videoP50 = findAction_(row.video_p50_watched_actions, "video_view");
  var impressions = Number(row.impressions) || 0;
  return {
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    link_clicks: row.inline_link_clicks,
    ctr: row.ctr,
    link_ctr: row.inline_link_click_ctr,
    cpm: row.cpm,
    cost_per_link_click: row.cost_per_inline_link_click,
    leads: findLeadAction_(row.actions),
    cost_per_lead: findLeadCost_(row.cost_per_action_type),
    landing_page_views: findAction_(row.actions, "landing_page_view"),
    video_plays: videoPlays,
    video_p25: findAction_(row.video_p25_watched_actions, "video_view"),
    video_p50: videoP50,
    video_p75: findAction_(row.video_p75_watched_actions, "video_view"),
    video_p95: findAction_(row.video_p95_watched_actions, "video_view"),
    video_p100: findAction_(row.video_p100_watched_actions, "video_view"),
    thruplays: findAction_(row.video_thruplay_watched_actions, "video_view"),
    video_avg_watch_seconds: findAction_(row.video_avg_time_watched_actions, "video_view"),
    // Marketer-standard ratios, not native API fields — Hook Rate = % of
    // people who watched at all after seeing the ad; Hold Rate (50%) = of
    // those who started watching, % who made it halfway.
    hook_rate: impressions ? Math.round((videoPlays / impressions) * 1000) / 10 : 0,
    hold_rate_50: videoPlays ? Math.round((videoP50 / videoPlays) * 1000) / 10 : 0,
  };
}

// Upserts `data` into `sheet`, matched on `keyField`'s value (not the row
// "id" convention the Calls/Clients/Leads sheets use — Campaigns/Ads are
// keyed by their own natural identifier instead).
function upsertInsightsRow_(sheet, headers, numberFields, keyField, data) {
  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  var keyIdx = headers.indexOf(keyField);
  var targetRow = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][keyIdx]) === String(data[keyField])) {
      targetRow = i + 2;
      break;
    }
  }
  var row = headers.map(function (h) {
    if (h === "updated_at") return new Date().toISOString();
    if (numberFields.indexOf(h) !== -1) return Number(data[h]) || 0;
    return String(data[h] || "");
  });
  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// Pulls last-30-day campaign-level metrics and upserts one row per campaign
// (keyed by campaign_name) into the Campaigns sheet. No-ops quietly if the
// token hasn't been set up yet, so this is safe to call from a trigger
// before setup is finished.
function fetchMetaInsights_() {
  var token = PropertiesService.getScriptProperties().getProperty("META_ACCESS_TOKEN");
  if (!token) {
    Logger.log("META_ACCESS_TOKEN not set — run setMetaToken_() first. Skipping.");
    return { ok: false, error: "Meta token not configured" };
  }

  var fields = ["campaign_name"].concat(META_INSIGHTS_FIELDS_).join(",");
  // Only currently-active campaigns — a paused one still shows up in a
  // last-30-day window until 30 days after it stopped spending, which would
  // otherwise leave stale rows sitting in the Campaigns sheet.
  var filtering = encodeURIComponent(
    JSON.stringify([{ field: "campaign.effective_status", operator: "IN", value: ["ACTIVE"] }])
  );
  var url =
    "https://graph.facebook.com/v21.0/" + META_AD_ACCOUNT_ID + "/insights" +
    "?level=campaign&fields=" + fields + "&filtering=" + filtering +
    "&date_preset=last_30d&access_token=" + encodeURIComponent(token);

  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var parsed = JSON.parse(response.getContentText());
  if (parsed.error) {
    Logger.log("Meta API error: " + JSON.stringify(parsed.error));
    return { ok: false, error: parsed.error.message || "Meta API error" };
  }

  var sheet = getSheet_("Campaigns", CAMPAIGN_HEADERS);
  (parsed.data || []).forEach(function (c) {
    var data = parseInsightsMetrics_(c);
    data.campaign_name = c.campaign_name;
    upsertInsightsRow_(sheet, CAMPAIGN_HEADERS, CAMPAIGN_NUMBER_FIELDS, "campaign_name", data);
  });

  var adResult = fetchMetaAdInsights_(token);
  return { ok: true, count: (parsed.data || []).length, adCount: adResult.count };
}

// Same idea as fetchMetaInsights_ but at ad (creative) level — one row per
// currently-active ad, keyed by ad_id. Called from fetchMetaInsights_ so a
// single trigger/button keeps both in sync; token is passed in rather than
// re-read since the caller already has it.
function fetchMetaAdInsights_(token) {
  var fields = ["ad_id", "ad_name", "campaign_name"].concat(META_INSIGHTS_FIELDS_).join(",");
  var filtering = encodeURIComponent(
    JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ["ACTIVE"] }])
  );
  var url =
    "https://graph.facebook.com/v21.0/" + META_AD_ACCOUNT_ID + "/insights" +
    "?level=ad&fields=" + fields + "&filtering=" + filtering +
    "&date_preset=last_30d&access_token=" + encodeURIComponent(token);

  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var parsed = JSON.parse(response.getContentText());
  if (parsed.error) {
    Logger.log("Meta API error (ads): " + JSON.stringify(parsed.error));
    return { ok: false, count: 0, error: parsed.error.message || "Meta API error" };
  }

  var sheet = getSheet_("Ads", AD_HEADERS);
  (parsed.data || []).forEach(function (a) {
    var data = parseInsightsMetrics_(a);
    data.ad_id = a.ad_id;
    data.ad_name = a.ad_name;
    data.campaign_name = a.campaign_name;
    upsertInsightsRow_(sheet, AD_HEADERS, AD_NUMBER_FIELDS, "ad_id", data);
  });

  return { ok: true, count: (parsed.data || []).length };
}

// Maps a Calendly event type name to which calendar link it was booked
// through. Matched by the "(H)"/"(EH)" suffix Tom's event types use — see
// README.md for how that mapping was confirmed. Falls back to "Direct /
// Unknown" for any event type without a recognised suffix (e.g. the plain
// "Systemised Scaling Strategy Session" type, which carries no UTM data).
function deriveSource_(eventType) {
  var t = String(eventType || "");
  if (t.indexOf("(H)") !== -1) return "Landing Page Calendar Link";
  if (t.indexOf("(EH)") !== -1) return "Email Calendar Link";
  return "Direct / Unknown";
}

// Builds a human-readable campaign label from Calendly's UTM tracking
// fields (utm_campaign / utm_content / utm_medium), for matching against
// Meta Ads later. Returns "" when there's no UTM data (e.g. email-sourced
// bookings, which carry utm_source=email but no campaign/content).
function deriveCampaign_(body) {
  var parts = [];
  if (body.utm_campaign) parts.push(String(body.utm_campaign));
  if (body.utm_content) parts.push(String(body.utm_content));
  var campaign = parts.join(" | ");
  if (body.utm_medium) campaign += (campaign ? " " : "") + "(" + body.utm_medium + ")";
  return campaign;
}

// Maps Calendly's IANA timezone string (the only per-lead location signal
// actually available — Meta's geo data is aggregate/per-campaign, not
// per-lead) to a readable location. Covers the regions seen so far; falls
// back to a cleaned-up version of the raw zone (e.g. "Asia/Dubai" ->
// "Asia / Dubai") for anything not explicitly mapped, so it's never blank
// as long as Calendly sent a timezone.
var TIMEZONE_LOCATIONS_ = {
  "America/New_York": "US (Eastern)",
  "America/Chicago": "US (Central)",
  "America/Denver": "US (Mountain)",
  "America/Los_Angeles": "US (Pacific)",
  "America/Phoenix": "US (Arizona)",
  "America/Vancouver": "Canada (Pacific)",
  "America/Edmonton": "Canada (Mountain)",
  "America/Winnipeg": "Canada (Central)",
  "America/Toronto": "Canada (Eastern)",
  "America/Halifax": "Canada (Atlantic)",
  "Europe/London": "UK",
  "Europe/Dublin": "Ireland",
  "Australia/Sydney": "Australia (Sydney)",
  "Australia/Melbourne": "Australia (Melbourne)",
  "Australia/Perth": "Australia (Perth)",
  "Pacific/Auckland": "New Zealand",
};

function deriveLocation_(timezone) {
  var tz = String(timezone || "").trim();
  if (!tz) return "";
  if (TIMEZONE_LOCATIONS_[tz]) return TIMEZONE_LOCATIONS_[tz];
  return tz.replace(/_/g, " ").replace("/", " / ");
}

// North American (+1) area codes -> region. Free, no API, no rate limits —
// covers every code seen in real data so far, plus the other major
// Canadian and US metros so it holds up as new leads come in from
// elsewhere in NANP. Not exhaustive (NANP has ~400 codes); anything
// missing falls through to a generic "US/Canada" label rather than
// guessing wrong.
var AREA_CODE_LOCATIONS_ = {
  // Ontario
  "416": "Toronto, Canada", "647": "Toronto, Canada", "437": "Toronto, Canada",
  "905": "Greater Toronto Area, Canada", "289": "Greater Toronto Area, Canada", "365": "Greater Toronto Area, Canada",
  "613": "Ottawa, Canada", "343": "Ottawa, Canada",
  "519": "Southwestern Ontario, Canada", "226": "Southwestern Ontario, Canada", "548": "Southwestern Ontario, Canada",
  "705": "Northern Ontario, Canada", "249": "Northern Ontario, Canada",
  "807": "Northwestern Ontario, Canada",
  // Quebec
  "514": "Montreal, Canada", "438": "Montreal, Canada", "263": "Montreal, Canada",
  "418": "Quebec City, Canada", "581": "Quebec City, Canada", "367": "Quebec City, Canada",
  // British Columbia
  "604": "Vancouver, Canada", "778": "Vancouver, Canada", "236": "Vancouver, Canada", "672": "Vancouver, Canada",
  "250": "British Columbia, Canada",
  // Prairies
  "403": "Calgary, Canada", "587": "Calgary, Canada", "825": "Calgary, Canada",
  "780": "Edmonton, Canada",
  "204": "Manitoba, Canada", "431": "Manitoba, Canada",
  "306": "Saskatchewan, Canada", "639": "Saskatchewan, Canada",
  // Atlantic
  "902": "Atlantic Canada", "782": "Atlantic Canada", "506": "Atlantic Canada", "709": "Atlantic Canada",
  // A few major US metros — extend as real US leads come in
  "212": "New York, US", "646": "New York, US", "917": "New York, US",
  "213": "Los Angeles, US", "310": "Los Angeles, US",
  "312": "Chicago, US",
  "305": "Miami, US",
  "617": "Boston, US",
  "202": "Washington DC, US",
};

// Full country-code -> country map is impractical to hand-maintain, so
// only the ones actually relevant here are listed; anything else falls
// back to showing the raw "+<code>" prefix rather than guessing.
var COUNTRY_CODE_LOCATIONS_ = {
  "44": "UK",
  "353": "Ireland",
  "61": "Australia",
  "64": "New Zealand",
};

// Derives a location from a phone number — real signal, zero cost, no API.
// +1 numbers (US/Canada share the country code) resolve via area code;
// everything else resolves via country code. Falls back to "" if the
// number doesn't parse cleanly.
function deriveLocationFromPhone_(phone) {
  var digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.charAt(0) === "1") {
    var areaCode = digits.substring(1, 4);
    return AREA_CODE_LOCATIONS_[areaCode] || "US / Canada";
  }
  if (digits.length === 10) {
    // No leading country code — assume NANP (the only case seen so far).
    return AREA_CODE_LOCATIONS_[digits.substring(0, 3)] || "US / Canada";
  }
  for (var code in COUNTRY_CODE_LOCATIONS_) {
    if (digits.indexOf(code) === 0) return COUNTRY_CODE_LOCATIONS_[code];
  }
  return "";
}

// Lead applications don't have a dedicated phone column — it's one of the
// dynamic question/answer pairs. Scan for a question that looks
// phone-related (same heuristic the app's own LeadsPage uses client-side).
function findAnswerPhone_(answers) {
  if (!answers) return "";
  for (var question in answers) {
    if (/phone|number/i.test(question)) {
      var value = answers[question];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

// Convenience entry point for automations (e.g. a Zapier "Webhooks by
// Zapier" POST step on a Calendly "Invitee Created" trigger, with no
// per-link filtering needed): dedupes on (invitee_email, start_time)
// instead of requiring an id, so a Zap retry or a reschedule-without-cancel
// doesn't create a second row. Auto-derives `source` from `event_type` and
// `campaign` from the utm_* fields unless the caller already set them
// explicitly (the app's own "+ Add Call" form always sets them directly via
// the "upsert_call" action instead, so this only affects webhook traffic).
function upsertCallFromWebhook_(call) {
  var sheet = getSheet_("Calls", CALL_HEADERS);
  var lastRow = sheet.getLastRow();
  var existingId = null;
  if (lastRow > 1) {
    var idIdx = CALL_HEADERS.indexOf("id");
    var emailIdx = CALL_HEADERS.indexOf("invitee_email");
    var startIdx = CALL_HEADERS.indexOf("start_time");
    var values = sheet.getRange(2, 1, lastRow - 1, CALL_HEADERS.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (
        String(values[i][emailIdx]).toLowerCase() === String(call.invitee_email || "").toLowerCase() &&
        sameInstant_(asDateString_(values[i][startIdx]), call.start_time)
      ) {
        existingId = values[i][idIdx];
        break;
      }
    }
  }
  var data = {};
  CALL_HEADERS.forEach(function (h) { data[h] = call[h]; });
  data.id = existingId;
  data.status = data.status || "Booked";
  data.source = call.source || deriveSource_(call.event_type);
  data.campaign = call.campaign || deriveCampaign_(call);
  data.meta_campaign_name = call.meta_campaign_name || call.utm_source || "";
  // utm_content carries Tom's ad name verbatim ("AD 1 - 07/08/26 - Wasting
  // Leads"), matching Meta's own ad_name field exactly.
  data.meta_ad_name = call.meta_ad_name || call.utm_content || "";
  // Phone-derived location is more precise (city/region vs. broad time
  // zone), so it's tried first; timezone is the fallback for whoever
  // didn't leave a phone number.
  data.location = call.location || deriveLocationFromPhone_(call.invitee_phone) || deriveLocation_(call.timezone);
  return upsertRow_(sheet, CALL_HEADERS, CALL_NUMBER_FIELDS, CALL_BOOLEAN_FIELDS, data);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === "upsert_call") {
      var callsSheet = getSheet_("Calls", CALL_HEADERS);
      var saved = upsertRow_(callsSheet, CALL_HEADERS, CALL_NUMBER_FIELDS, CALL_BOOLEAN_FIELDS, body.call || {});
      return json_({ ok: true, call: saved });
    }

    if (body.action === "delete_call") {
      var cs = getSheet_("Calls", CALL_HEADERS);
      return json_(deleteRowById_(cs, body.id));
    }

    if (body.action === "calendly_webhook") {
      var savedCall = upsertCallFromWebhook_(body);
      return json_({ ok: true, call: savedCall });
    }

    // Fired by a Supabase Database Webhook (pg_net trigger) on every INSERT
    // into questionnaire_submissions in the Lovable app. Payload shape:
    // {action, id, name, email, answers, questionnaire_id, created_at}.
    // Uses the submission's own Supabase id as our row id, so a webhook
    // retry updates in place instead of duplicating.
    if (body.action === "lead_submission") {
      var leadsSheet = getSheet_("Leads", LEAD_HEADERS);
      var leadPhone = findAnswerPhone_(body.answers);
      var leadData = {
        id: body.id,
        questionnaire_id: body.questionnaire_id || "",
        name: body.name || "",
        email: body.email || "",
        answers: JSON.stringify(body.answers || {}),
        created_at: body.created_at || "",
        location: deriveLocationFromPhone_(leadPhone),
      };
      var savedLead = upsertRow_(leadsSheet, LEAD_HEADERS, LEAD_NUMBER_FIELDS, [], leadData);
      return json_({ ok: true, lead: savedLead });
    }

    if (body.action === "upsert_client") {
      var clientsSheet = getSheet_("Clients", CLIENT_HEADERS);
      var savedClient = upsertRow_(clientsSheet, CLIENT_HEADERS, CLIENT_NUMBER_FIELDS, [], body.client || {});
      return json_({ ok: true, client: savedClient });
    }

    if (body.action === "delete_client") {
      var cls = getSheet_("Clients", CLIENT_HEADERS);
      return json_(deleteRowById_(cls, body.id));
    }

    if (body.action === "sync_meta_now") {
      return json_(fetchMetaInsights_());
    }

    if (body.action === "delete_campaign") {
      var campSheet = getSheet_("Campaigns", CAMPAIGN_HEADERS);
      var nameCol = CAMPAIGN_HEADERS.indexOf("campaign_name") + 1;
      var lastRow = campSheet.getLastRow();
      if (lastRow > 1) {
        var names = campSheet.getRange(2, nameCol, lastRow - 1, 1).getValues();
        for (var i = 0; i < names.length; i++) {
          if (String(names[i][0]) === String(body.campaign_name)) {
            campSheet.deleteRow(i + 2);
            return json_({ ok: true });
          }
        }
      }
      return json_({ ok: false, error: "Campaign not found: " + body.campaign_name });
    }

    if (body.action === "delete_ad") {
      var adSheet = getSheet_("Ads", AD_HEADERS);
      var adIdCol = AD_HEADERS.indexOf("ad_id") + 1;
      var adLastRow = adSheet.getLastRow();
      if (adLastRow > 1) {
        var adIds = adSheet.getRange(2, adIdCol, adLastRow - 1, 1).getValues();
        for (var j = 0; j < adIds.length; j++) {
          if (String(adIds[j][0]) === String(body.ad_id)) {
            adSheet.deleteRow(j + 2);
            return json_({ ok: true });
          }
        }
      }
      return json_({ ok: false, error: "Ad not found: " + body.ad_id });
    }

    return json_({ ok: false, error: "Unknown action: " + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
