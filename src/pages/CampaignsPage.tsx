import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { fetchAll, syncMetaNow, isConfigured } from "../lib/api";
import type { Ad, Call, Campaign } from "../lib/types";
import { Button, Kpi, Panel } from "../components/ui";

const fmt$ = (n: number) => "£" + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtN = (n: number) => (n || 0).toLocaleString();
const fmtPct = (n: number) => (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";

type CallStats = {
  bookedCalls: number;
  costPerCall: number | null;
  shownCalls: number;
  costPerShownCall: number | null;
  qualifiedCalls: number;
  costPerQualifiedCall: number | null;
};

type Row = Campaign & CallStats;
type AdRow = Ad & CallStats;

function callStats(spend: number, matchedCalls: Call[]): CallStats {
  const bookedCalls = matchedCalls.length;
  // "Shown" here means they actually showed up, regardless of what
  // happened after — Closed calls obviously showed too.
  const shownCalls = matchedCalls.filter((c) => c.status === "Shown" || c.status === "Closed").length;
  const qualifiedCalls = matchedCalls.filter((c) => c.qualified === "Qualified").length;
  return {
    bookedCalls,
    costPerCall: bookedCalls ? spend / bookedCalls : null,
    shownCalls,
    costPerShownCall: shownCalls ? spend / shownCalls : null,
    qualifiedCalls,
    costPerQualifiedCall: qualifiedCalls ? spend / qualifiedCalls : null,
  };
}

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

// Shared by both the per-campaign and per-ad cards — Ad and Campaign carry
// the exact same metric fields, just at different granularity.
function PerformanceCard({
  title,
  subtitle,
  r,
}: {
  title: string;
  subtitle?: string;
  r: Campaign & CallStats | Ad & CallStats;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
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
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setCampaigns(data.campaigns);
      setAds(data.ads);
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
        return { ...c, ...callStats(c.spend, campaignCalls) };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [campaigns, calls]);

  // Same idea as `rows` but at ad granularity — matched via meta_ad_name,
  // which carries the raw utm_content value (Tom's ad name, verbatim).
  const adRows: AdRow[] = useMemo(() => {
    return ads
      .map((a) => {
        const adCalls = calls.filter((call) => !call.is_duplicate && call.meta_ad_name === a.ad_name);
        return { ...a, ...callStats(a.spend, adCalls) };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [ads, calls]);

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

      {!loading && rows.map((r) => <PerformanceCard key={r.campaign_name} title={r.campaign_name} r={r} />)}

      {!loading && adRows.length > 0 && (
        <>
          <h2 className="mt-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Live Ads
          </h2>
          {adRows.map((r) => (
            <PerformanceCard key={r.ad_id} title={r.ad_name} subtitle={r.campaign_name} r={r} />
          ))}
        </>
      )}
    </div>
  );
}
