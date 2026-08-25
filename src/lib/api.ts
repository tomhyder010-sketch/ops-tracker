import type { Ad, Call, Campaign, Client, Lead, NewCall, NewClient } from "./types";

// The Google Apps Script web-app URL (ends in /exec) — once you've deployed
// apps-script/Code.gs inside your Google Sheet (see README.md), paste the
// URL here so it's baked into every build.
export const API_URL =
  "https://script.google.com/macros/s/AKfycbw6S5IVHTBusxH7SyyLbHT5oc52FXqtpSSHjG-46wIhb7YRmwNKe8Yp6jrplxbd-ojFcw/exec";

// Local override so the app can be pointed at a backend without a rebuild:
// localStorage.setItem('ops_api_url', 'https://…/exec')
export const apiUrl = (): string =>
  localStorage.getItem("ops_api_url") || API_URL;

export const isConfigured = () => apiUrl() !== "";

// ---- localStorage fallback --------------------------------------------
// Runs immediately with no setup, same as the SOP hub — everything lives in
// this browser only until you connect the Sheet (see README.md).

type LocalDb = { calls: Call[]; clients: Client[]; campaigns: Campaign[]; ads: Ad[]; leads: Lead[] };

const LOCAL_KEY = "ops_tracker_v1";

function loadLocal(): LocalDb {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return { calls: [], clients: [], campaigns: [], ads: [], leads: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      calls: parsed.calls ?? [],
      clients: parsed.clients ?? [],
      campaigns: parsed.campaigns ?? [],
      ads: parsed.ads ?? [],
      leads: parsed.leads ?? [],
    };
  } catch {
    return { calls: [], clients: [], campaigns: [], ads: [], leads: [] };
  }
}

function saveLocal(db: LocalDb) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

// ---- remote (Apps Script) helpers --------------------------------------

// Content-type is deliberately text/plain: it keeps the request "simple" so
// the browser skips the CORS preflight that Apps Script can't answer.
async function post(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(apiUrl(), {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Backend error");
  return data;
}

export type AllData = { calls: Call[]; clients: Client[]; campaigns: Campaign[]; ads: Ad[]; leads: Lead[] };

// Apps Script's own request latency is several seconds regardless of what
// it's doing (auth + routing overhead, not our code) — that's fixed cost we
// can't remove. What we CAN remove is paying it again every time the user
// switches tabs: each page (Leads/Calls/Clients/Campaigns) mounts fresh and
// calls fetchAll() on its own, even though it's the exact same "give me
// everything" request every time. This cache makes tab-switching instant
// after the first load; any mutation below invalidates it so the follow-up
// reload each page already does after saving gets truly fresh data.
let cache: { data: AllData; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

function invalidateCache() {
  cache = null;
}

export async function fetchAll(): Promise<AllData> {
  if (!isConfigured()) return loadLocal();
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const res = await fetch(apiUrl());
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Backend error");
  const all: AllData = {
    calls: data.calls ?? [],
    clients: data.clients ?? [],
    campaigns: data.campaigns ?? [],
    ads: data.ads ?? [],
    leads: data.leads ?? [],
  };
  cache = { data: all, at: Date.now() };
  return all;
}

// Triggers an on-demand Meta Ads sync (in addition to the automatic 6-hour
// schedule set up in Code.gs) — a no-op in local mode, since there's no
// backend to sync against.
export async function syncMetaNow(): Promise<void> {
  if (!isConfigured()) return;
  await post({ action: "sync_meta_now" });
  invalidateCache();
}

// ---- calls --------------------------------------------------------------

export async function upsertCall(call: NewCall & { id?: string }): Promise<void> {
  if (!isConfigured()) {
    const db = loadLocal();
    if (call.id) {
      const i = db.calls.findIndex((c) => c.id === call.id);
      if (i !== -1) {
        db.calls[i] = { ...db.calls[i], ...call, updated_at: nowIso() };
      }
    } else {
      db.calls.push({ ...call, id: uid(), created_at: nowIso(), updated_at: nowIso() });
    }
    saveLocal(db);
    return;
  }
  await post({ action: "upsert_call", call });
  invalidateCache();
}

export async function deleteCall(id: string): Promise<void> {
  if (!isConfigured()) {
    const db = loadLocal();
    db.calls = db.calls.filter((c) => c.id !== id);
    saveLocal(db);
    return;
  }
  await post({ action: "delete_call", id });
  invalidateCache();
}

// ---- clients --------------------------------------------------------------

export async function upsertClient(client: NewClient & { id?: string }): Promise<void> {
  if (!isConfigured()) {
    const db = loadLocal();
    if (client.id) {
      const i = db.clients.findIndex((c) => c.id === client.id);
      if (i !== -1) {
        db.clients[i] = { ...db.clients[i], ...client, updated_at: nowIso() };
      }
    } else {
      db.clients.push({ ...client, id: uid(), created_at: nowIso(), updated_at: nowIso() });
    }
    saveLocal(db);
    return;
  }
  await post({ action: "upsert_client", client });
  invalidateCache();
}

export async function deleteClient(id: string): Promise<void> {
  if (!isConfigured()) {
    const db = loadLocal();
    db.clients = db.clients.filter((c) => c.id !== id);
    saveLocal(db);
    return;
  }
  await post({ action: "delete_client", id });
  invalidateCache();
}
