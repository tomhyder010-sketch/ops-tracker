import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { fetchAll, syncMetaNow, isConfigured } from "../lib/api";
import type { Call, Campaign } from "../lib/types";
import { Button, Kpi, Panel } from "../components/ui";

const fmt$ = (n: number) => "£" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtN = (n: number) => (n || 0).toLocaleString();
const fmtPct = (n: number) => (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";

type Row = Campaign & {
  bookedCalls: number;
  costPerCall: number | null;
  shownCalls: number;
  costPerShownCall: number | null;
  qualifiedCalls: number;
  costPerQualifiedCall: number | null;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function MetricGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-primary">{title}</div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">{children}</div>
    </div>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setCampaigns(data.campaigns);
      setCalls(data.calls);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function refreshNow() {
    setSyncing(true);
    try {
      await syncMetaNow();
      toast.success("Meta Ads data refreshed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setSyncing(false);
    }
  }

  const rows: Row[] = useMemo(() => {
    return campaigns
      .map((c) => {
        const campaignCalls = calls.filter(
          (call) => !call.is_duplicate && call.meta_campaign_name === c.campaign_name
        );
        const bookedCalls = campaignCalls.length;
        // "Shown" here means they actually showed up, regardless of what
        // happened after — Closed calls obviously showed too.
        const shownCalls = campaignCalls.filter(
          (call) => call.status === "Shown" || call.status === "Closed"
        ).length;
        const qualifiedCalls = campaignCalls.filter((call) => call.qualified === "Qualified").length;
        return {
          ...c,
          bookedCalls,
          costPerCall: bookedCalls ? c.spend / bookedCalls : null,
          shownCalls,
          costPerShownCall: shownCalls ? c.spend / shownCalls : null,
          qualifiedCalls,
          costPerQualifiedCall: qualifiedCalls ? c.spend / qualifiedCalls : null,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns, calls]);

  const totals = useMemo(() => {
    const spend = campaigns.reduce((sum, c) => sum + c.spend, 0);
    const leads = campaigns.reduce((sum, c) => sum + c.leads, 0);
    const bookedCalls = rows.reduce((sum, r) => sum + r.bookedCalls, 0);
    const shownCalls = rows.reduce((sum, r) => sum + r.shownCalls, 0);
    const qualifiedCalls = rows.reduce((sum, r) => sum + r.qualifiedCalls, 0);
    return {
      spend,
      leads,
      bookedCalls,
      costPerCall: bookedCalls ? spend / bookedCalls : null,
      shownCalls,
      costPerShownCall: shownCalls ? spend / shownCalls : null,
      qualifiedCalls,
      costPerQualifiedCall: qualifiedCalls ? spend / qualifiedCalls : null,
    };
  }, [campaigns, rows]);

  const lastUpdated = campaigns.length
    ? campaigns.reduce((latest, c) => (c.updated_at > latest ? c.updated_at : latest), campaigns[0].updated_at)
    : null;

  return (
    <div className="flex flex-col gap-4">
      {!isConfigured() && (
        <Panel title="Not connected">
          <p className="text-sm text-muted-foreground">
            Campaign data comes from the Sheet backend — connect it first (see README) to see Meta Ads spend here.
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Spend (30d)" value={fmt$(totals.spend)} />
        <Kpi label="Leads (30d)" value={fmtN(totals.leads)} />
        <Kpi label="Booked Calls" value={totals.bookedCalls} sub="matched to a campaign" />
        <Kpi
          label="Cost / Booked Call"
          value={totals.costPerCall === null ? "—" : fmt$(totals.costPerCall)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Shown Calls" value={totals.shownCalls} />
        <Kpi
          label="Cost / Shown Call"
          value={totals.costPerShownCall === null ? "—" : fmt$(totals.costPerShownCall)}
        />
        <Kpi label="Qualified Calls" value={totals.qualifiedCalls} />
        <Kpi
          label="Cost / Qualified Call"
          value={totals.costPerQualifiedCall === null ? "—" : fmt$(totals.costPerQualifiedCall)}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
        <span className="text-xs text-muted-foreground">
          {lastUpdated ? `Last synced ${new Date(lastUpdated).toLocaleString()}` : "Never synced yet"} — auto-refreshes every 6 hours
        </span>
        <Button size="sm" variant="outline" onClick={refreshNow} disabled={syncing || !isConfigured()}>
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Refresh Now"}
        </Button>
      </div>

      {loading && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No campaign data yet — click "Refresh Now" once the Meta token is configured (see README).
        </div>
      )}

      {!loading &&
        rows.map((r) => (
          <div key={r.campaign_name} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-bold">{r.campaign_name}</h3>
              <span className="text-xs text-muted-foreground">
                {r.bookedCalls} booked call{r.bookedCalls === 1 ? "" : "s"}
                {r.costPerCall !== null && ` · ${fmt$(r.costPerCall)}/call`}
              </span>
            </div>

            <MetricGroup title="Overview">
              <Metric label="Spend" value={fmt$(r.spend)} />
              <Metric label="Impressions" value={fmtN(r.impressions)} />
              <Metric label="Reach" value={fmtN(r.reach)} />
              <Metric label="Clicks" value={fmtN(r.clicks)} />
              <Metric label="Link Clicks" value={fmtN(r.link_clicks)} />
              <Metric label="CTR (link)" value={fmtPct(r.link_ctr)} />
              <Metric label="CPM" value={fmt$(r.cpm)} />
              <Metric label="Cost / Link Click" value={fmt$(r.cost_per_link_click)} />
            </MetricGroup>

            <MetricGroup title="Conversions">
              <Metric label="Leads (Results)" value={fmtN(r.leads)} />
              <Metric label="Cost / Result" value={r.leads ? fmt$(r.cost_per_lead) : "—"} />
              <Metric label="Landing Page Views" value={fmtN(r.landing_page_views)} />
              <Metric label="Booked Calls" value={fmtN(r.bookedCalls)} />
              <Metric label="Cost / Booked Call" value={r.costPerCall === null ? "—" : fmt$(r.costPerCall)} />
              <Metric label="Shown Calls" value={fmtN(r.shownCalls)} />
              <Metric label="Cost / Shown Call" value={r.costPerShownCall === null ? "—" : fmt$(r.costPerShownCall)} />
              <Metric label="Qualified Calls" value={fmtN(r.qualifiedCalls)} />
              <Metric label="Cost / Qualified Call" value={r.costPerQualifiedCall === null ? "—" : fmt$(r.costPerQualifiedCall)} />
            </MetricGroup>

            <MetricGroup title="Video Engagement">
              <Metric label="Video Plays" value={fmtN(r.video_plays)} />
              <Metric label="ThruPlays" value={fmtN(r.thruplays)} />
              <Metric label="Hook Rate" value={fmtPct(r.hook_rate)} />
              <Metric label="Hold Rate (50%)" value={fmtPct(r.hold_rate_50)} />
              <Metric label="Avg Watch Time" value={r.video_avg_watch_seconds ? `${r.video_avg_watch_seconds}s` : "—"} />
              <Metric label="Made it to 25%" value={fmtN(r.video_p25)} />
              <Metric label="Made it to 50%" value={fmtN(r.video_p50)} />
              <Metric label="Made it to 75%" value={fmtN(r.video_p75)} />
              <Metric label="Made it to 95%" value={fmtN(r.video_p95)} />
              <Metric label="Made it to 100%" value={fmtN(r.video_p100)} />
            </MetricGroup>
          </div>
        ))}

      <p className="text-xs text-muted-foreground">
        "Leads (Results)" and "Cost / Result" use whichever conversion action fired for the campaign
        (lead form, pixel lead event, etc.) — matches Ads Manager's "Results" column for a lead-gen
        campaign. Hook Rate and Hold Rate aren't native Meta fields — they're the standard marketer
        calculations (Hook = video plays ÷ impressions, Hold = 50%-watched ÷ video plays), computed
        from Meta's raw video-retention data. "Cost per unique link click" and "Video percentage
        watched" weren't included — the "unique" and exact percentage-watched fields weren't
        confirmed against the live API, so ask if you want those added properly rather than guessed.
      </p>
    </div>
  );
}
