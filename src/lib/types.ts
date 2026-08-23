export const CALL_STATUSES = [
  "Booked",
  "Cancelled",
  "Shown",
  "No Show",
  "Closed",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

// Follow-up temperature — a tag independent of the pipeline status (a call
// can be "Shown" and "Warm" at the same time). "" means not yet assessed.
export const CALL_TEMPERATURES = ["", "Warm", "Cold", "Lost"] as const;
export type CallTemperature = (typeof CALL_TEMPERATURES)[number];

// Whether the prospect was actually qualified on the call — feeds "Cost per
// Qualified Call" on the Ad Campaigns tab. "" means not yet assessed.
export const CALL_QUALIFIED_OPTIONS = ["", "Qualified", "Not Qualified"] as const;
export type CallQualified = (typeof CALL_QUALIFIED_OPTIONS)[number];

// Suggested values for the "source" field (which Calendly link the call came
// from) — shown as datalist suggestions, but the field stays free text so it
// grows with whatever Zapier/Calendly actually sends.
export const CALL_SOURCE_SUGGESTIONS = [
  "Email Calendar Link",
  "Landing Page Calendar Link",
  "Manual",
] as const;

export interface Call {
  id: string;
  start_time: string; // ISO datetime — when the call is/was scheduled
  booked_at: string; // ISO datetime — when the booking was made
  invitee_name: string;
  invitee_email: string;
  invitee_phone: string;
  source: string; // which Calendly link it came from
  event_type: string; // Calendly event type name
  campaign: string; // human-readable ad/campaign label (campaign + ad + placement)
  status: CallStatus;
  value: number; // cash collected on this call ($/£), editable directly
  is_duplicate: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
  // Raw utm_source — this is what actually carries the Meta *campaign* name
  // in Tom's ad setup (utm_campaign holds a different, broader label), so
  // it's the join key against Campaign.campaign_name.
  meta_campaign_name: string;
  // Invitee's location, derived from Calendly's timezone (the only
  // per-lead location signal available — Meta's geo data is
  // aggregate/per-campaign, not per-lead).
  location: string;
  temperature: CallTemperature;
  qualified: CallQualified;
  // Raw utm_content — Tom's ad names ("AD 1 - 07/08/26 - Wasting Leads")
  // live here, matching Meta's ad_name field exactly.
  meta_ad_name: string;
}

export type NewCall = Omit<Call, "id" | "created_at" | "updated_at">;

export interface Campaign {
  campaign_name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  ctr: number; // %
  link_ctr: number; // %
  cpm: number; // cost per 1,000 impressions
  cost_per_link_click: number;
  leads: number;
  cost_per_lead: number;
  landing_page_views: number;
  video_plays: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p95: number;
  video_p100: number;
  thruplays: number;
  video_avg_watch_seconds: number;
  hook_rate: number; // % — video_plays / impressions
  hold_rate_50: number; // % — video_p50 / video_plays
  updated_at: string;
}

// Same metrics as Campaign, at individual ad (creative) granularity.
export interface Ad {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  link_clicks: number;
  ctr: number;
  link_ctr: number;
  cpm: number;
  cost_per_link_click: number;
  leads: number;
  cost_per_lead: number;
  landing_page_views: number;
  video_plays: number;
  video_p25: number;
  video_p50: number;
  video_p75: number;
  video_p95: number;
  video_p100: number;
  thruplays: number;
  video_avg_watch_seconds: number;
  hook_rate: number;
  hold_rate_50: number;
  updated_at: string;
}

// One row per application/questionnaire submission from the Lovable app,
// pushed live via a Supabase Database Webhook. "answers" arrives as a JSON
// string (Sheets cells are text/number only) — parse before use.
export interface Lead {
  id: string;
  questionnaire_id: string;
  name: string;
  email: string;
  answers: string; // JSON-encoded { [question_text]: answer }
  created_at: string;
  updated_at: string;
  // Derived from whichever answer looks like a phone number — area code
  // for +1 numbers (Canada/US share a country code), country code
  // otherwise. Free, no API, no per-lead IP lookup needed.
  location: string;
}

export const QUESTIONNAIRE_NAMES: Record<string, string> = {
  "d97b61de-27f1-4916-9f33-ff4e862e3b92": "Home Improvement",
  // Coaches / Agencies questionnaire_id not seen in real data yet — add it
  // here once a lead comes through on that funnel.
};

// Answer keys to hide from the Leads tab — questions Tom doesn't actually
// use operationally, even though they still exist in the questionnaire.
export const HIDDEN_ANSWER_KEYS = ["How many leads does your business get a month?"];

export const CLIENT_STATUSES = ["Active", "Paused", "Churned", "One Time"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface Client {
  id: string;
  name: string;
  contact_name: string;
  status: ClientStatus;
  monthly_value: number; // MRR / ongoing subscription value
  // Total cash actually collected to date — this IS the LTV figure, no
  // separate estimate/formula on top of it.
  cash_collected: number;
  start_date: string;
  churn_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type NewClient = Omit<Client, "id" | "created_at" | "updated_at">;
