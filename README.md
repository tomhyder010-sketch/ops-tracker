# Ops Tracker

Multi-purpose tracker for Systemised Scaling, in the same branding as the
setter dashboard and SOP hub (theme lifted from www.systemised-scaling.com).
Self-owned static site (free to host) storing everything in a **Google
Sheet** Tom owns. No Lovable, no Supabase, no logins.

**Phase 1 (this build):**
- **Booked Calls** — every Calendly booking (from both the email link and the
  landing page link), with a status pipeline (Booked → Shown / No Show →
  Closed → Cash Collected), a duplicate flag + filter, and delete.
- **Clients** — roster with deal value, MRR/subscription value, a running
  cash-collected total, and an estimated LTV (deal value + MRR × months
  active).

**Not built yet (see "What's next" below):** a Follow-Up tab synced to GHL,
and Meta Ads campaign matching on the Calls tab. Both need you to connect
credentials first — the `campaign` field on each call is already there so
Meta matching can slot in without a data-model change.

## Runs immediately (localStorage), goes shared when you connect the Sheet

Out of the box the tracker stores everything in your browser (localStorage)
so it's usable the second it loads — great for trying it out, but **not
shared** between devices. To make it real (and to let Zapier/Calendly write
into it), connect the Google Sheet:

### 1. Create the backend (once, ~3 min)

1. Create a blank Google Sheet — [sheets.new](https://sheets.new). Name it
   e.g. "Ops Tracker".
2. **Extensions → Apps Script**, delete any code, paste
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Deploy → New deployment → Web app**, Execute as: **Me**, Who has
   access: **Anyone**. Authorise when prompted.
4. Copy the **Web app URL** (ends in `/exec`).

The script auto-creates two tabs — **Calls** and **Clients** — which you can
also hand-edit directly in Sheets if you ever need to fix a row by hand.

### 2. Point the app at it

Paste the `/exec` URL into `API_URL` in [`src/lib/api.ts`](src/lib/api.ts)
and rebuild. (Or, without rebuilding, run in the browser console:
`localStorage.setItem('ops_api_url', 'https://…/exec')` — handy for a quick
test.) Once set, every read/write goes to the shared Sheet, and the amber
"Local mode" banner in the header disappears.

> If you change `Code.gs` later, redeploy: **Deploy → Manage deployments →
> edit (pencil) → Version: New version**, so the same `/exec` URL keeps
> working.

### 3. Auto-import Calendly bookings (optional, via Zapier)

You're already connected to Zapier with a Calendly app available
("CalendlyCLIAPI") and a "Webhooks by Zapier" action can POST straight to
the `/exec` URL above. Set up **one Zap per calendar link** so each can be
tagged with the right `source`:

1. **Trigger:** Calendly → *Invitee Created*, scoped to the event type behind
   that link (e.g. the one embedded on your landing page, or the one you
   send from your personal email).
2. **Action:** Webhooks by Zapier → *POST* to your `/exec` URL, with:
   - Payload Type: `json`
   - Body:
     ```json
     {
       "action": "calendly_webhook",
       "source": "Landing Page Calendar Link",
       "event_type": "{{Event Type Name}}",
       "invitee_name": "{{Invitee Name}}",
       "invitee_email": "{{Invitee Email}}",
       "invitee_phone": "{{Invitee Text Reminder Number}}",
       "start_time": "{{Event Start Time}}",
       "booked_at": "{{Created At}}"
     }
     ```
     (map the `{{…}}` fields from Calendly's actual trigger output in
     Zapier's UI — the exact field names it offers may differ slightly from
     the labels above).
   - Set `"source"` to whatever you want that link to show up as in the
     tracker (e.g. `"Email Calendar Link"` for the second Zap).
3. Repeat for the other calendar link with a different `source` value.

The backend dedupes on `(invitee_email, start_time)`, so a Zap retry or a
Calendly reschedule-without-cancel updates the same row instead of creating
a duplicate. True double-bookings (same person booking twice) will still
come through as two rows — use the "Mark as duplicate" button on one of them.

If your Zapier plan doesn't include "Webhooks by Zapier", the fallback is a
Zap step that writes a new row directly into the Sheet's **Calls** tab
instead (Google Sheets → Create Spreadsheet Row) — just match the column
order in `CALL_HEADERS` at the top of `Code.gs`.

## What's next (Phase 2 / 3 — needs your credentials)

- **Meta Ads matching:** pull spend/CPL/CPA per campaign via the official
  Meta Marketing API (a system-user access token from Business Manager —
  the sanctioned way to read your own ad account's data, not a scraper) and
  join it to calls by the `campaign` field. Tag a call's campaign either by
  hand or by passing a Calendly hidden field (UTM) through from your ad's
  landing page.
- **Follow-Up ↔ GHL sync:** a Follow-Up tab where moving a contact's stage
  pushes the same stage change to your GHL pipeline, via GHL's own Zapier
  app ("LeadConnector"). Needs your GHL API access wired into a connection
  Zapier holds (keeps the key out of this codebase).

Both slot into the same Sheet/Apps Script backend — ping me when you're
ready to wire either one up.

## Run locally

```sh
npm install
npm run dev        # http://localhost:5182
```

## Deploy

`npm run build` outputs a fully static `dist/` (relative paths, no routing
dependencies), so it works on any static host — GitHub Pages, Netlify,
Vercel, Cloudflare Pages — with no special configuration.
