import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteEmailCost, fetchAll, upsertEmailCost } from "../lib/api";
import {
  EMAIL_COST_CATEGORIES,
  EMAIL_COST_FREQUENCIES,
  type EmailAutoCost,
  type EmailCohort,
  type EmailCost,
  type EmailDaily,
  type NewEmailCost,
} from "../lib/types";
import { Badge, Button, Input, Kpi, Label, Modal, Panel, Select, Textarea } from "../components/ui";

// Cold email costs are mostly billed in USD (Instantly, Apify, AI Ark…), so
// this tab works in $ — unlike Ad Campaigns, which follows Meta's £ account.
const fmt$ = (n: number | null) =>
  n === null ? "—" : "$" + n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 });
const fmtN = (n: number) => (n || 0).toLocaleString();
const pct = (num: number, den: number) => (den ? ((num / den) * 100).toFixed(1) + "%" : "—");
const per = (cost: number, n: number) => (n ? cost / n : null);

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const dayCount = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);

const RANGES = [
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "all", label: "All time" },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

const addMonths = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

// What Tom has actually paid in [from, to] (Tom 2026-10-26: cash, never spread
// per day). Each payment counts in full on its billing date: the start date,
// then every month (monthly) or year (yearly) after, until the end date.
// One-offs count once on their date.
function costOverRange(c: EmailCost, from: string, to: string): number {
  if (c.frequency === "one-off") return c.start_date >= from && c.start_date <= to ? c.amount : 0;
  const step = c.frequency === "yearly" ? 12 : 1;
  const last = c.end_date && c.end_date < to ? c.end_date : to;
  let total = 0;
  for (let i = 0, d = c.start_date; d <= last && i < 600; i++, d = addMonths(c.start_date, i * step)) {
    if (d >= from) total += c.amount;
  }
  return total;
}


type Totals = { sent: number; leads: number; replies: number; positive: number; booked: number };
const emptyTotals = (): Totals => ({ sent: 0, leads: 0, replies: 0, positive: 0, booked: 0 });

function addDay(t: Totals, d: EmailDaily) {
  t.sent += d.sent;
  t.leads += d.new_leads;
  t.replies += Math.max(0, d.replies - d.auto_replies);
  t.positive += d.positive;
  t.booked += d.booked;
}

const BLANK_COST: NewEmailCost = {
  name: "",
  category: "Sending software",
  amount: 0,
  frequency: "monthly",
  start_date: today(),
  end_date: "",
  notes: "",
};

export default function EmailPage() {
  const [daily, setDaily] = useState<EmailDaily[]>([]);
  const [cohorts, setCohorts] = useState<EmailCohort[]>([]);
  const [autoCosts, setAutoCosts] = useState<EmailAutoCost[]>([]);
  const [costs, setCosts] = useState<EmailCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeId>("30");
  const [campaign, setCampaign] = useState("all");
  const [editing, setEditing] = useState<(NewEmailCost & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setDaily(data.emailDaily);
      setCohorts(data.emailCohorts);
      setAutoCosts(data.emailAutoCosts);
      setCosts(data.emailCosts);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load cold email data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // "All time" starts at the earliest of any send or any cost — set-up costs
  // (domains, inboxes warming) are often paid before the first email goes out.
  const firstDate = useMemo(
    () =>
      [...daily.map((d) => d.date), ...costs.map((c) => c.start_date), ...autoCosts.map((a) => a.date)].reduce(
        (m, d) => (d && d < m ? d : m),
        today()
      ),
    [daily, costs, autoCosts]
  );
  const from = range === "all" ? firstDate : daysAgo(Number(range) - 1);
  const to = today();

  const campaignNames = useMemo(() => {
    const m = new Map<string, string>();
    daily.forEach((d) => m.set(d.campaign_id, d.campaign_name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [daily]);

  const inRange = useMemo(
    () => daily.filter((d) => d.date >= from && d.date <= to),
    [daily, from, to]
  );

  const totalCost = useMemo(() => {
    const manual = costs.reduce((s, c) => s + costOverRange(c, from, to), 0);
    const auto = autoCosts.filter((a) => a.date >= from && a.date <= to).reduce((s, a) => s + a.amount, 0);
    return { manual, auto, all: manual + auto };
  }, [costs, autoCosts, from, to]);

  const byCampaign = useMemo(() => {
    const m = new Map<string, Totals & { name: string }>();
    inRange.forEach((d) => {
      const t = m.get(d.campaign_id) ?? { ...emptyTotals(), name: d.campaign_name };
      addDay(t, d);
      m.set(d.campaign_id, t);
    });
    return [...m.entries()].sort((a, b) => b[1].sent - a[1].sent);
  }, [inRange]);

  const allSent = byCampaign.reduce((s, [, t]) => s + t.sent, 0);
  // Costs aren't tagged per campaign, so each campaign carries its share by emails sent.
  const share = (sent: number) => (allSent ? totalCost.all * (sent / allSent) : 0);

  const shown = useMemo(() => {
    const t = emptyTotals();
    inRange.filter((d) => campaign === "all" || d.campaign_id === campaign).forEach((d) => addDay(t, d));
    return t;
  }, [inRange, campaign]);
  const shownCost = campaign === "all" ? totalCost.all : share(shown.sent);

  const cohortRows = useMemo(() => {
    const m = new Map<string, { leads: number; replied: number; positive: number; booked: number }>();
    cohorts
      .filter((c) => campaign === "all" || c.campaign_id === campaign)
      .forEach((c) => {
        const r = m.get(c.week_start) ?? { leads: 0, replied: 0, positive: 0, booked: 0 };
        r.leads += c.leads;
        r.replied += c.replied;
        r.positive += c.positive;
        r.booked += c.booked;
        m.set(c.week_start, r);
      });
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  }, [cohorts, campaign]);

  // Josh Dueck's burned-inbox check: if replies per new lead fall 40%+ below
  // the campaign's normal rate (previous 28 days) with real volume, suspect
  // spam placement before blaming copy.
  const health = useMemo(() => {
    const out: { name: string; recent: number; base: number }[] = [];
    const last7 = daysAgo(6);
    const base28 = daysAgo(34);
    campaignNames.forEach(([id, name]) => {
      const rows = daily.filter((d) => d.campaign_id === id);
      const r = emptyTotals();
      const b = emptyTotals();
      rows.filter((d) => d.date >= last7).forEach((d) => addDay(r, d));
      rows.filter((d) => d.date >= base28 && d.date < last7).forEach((d) => addDay(b, d));
      if (r.leads < 150 || b.leads < 300) return;
      const recent = r.replies / r.leads;
      const base = b.replies / b.leads;
      if (base > 0 && recent < base * 0.6) out.push({ name, recent, base });
    });
    return out;
  }, [daily, campaignNames]);

  async function saveCost() {
    if (!editing) return;
    if (!editing.name.trim()) return toast.error("Give the cost a name");
    if (!(editing.amount > 0)) return toast.error("Enter an amount above 0");
    if (!editing.start_date) return toast.error("Pick a start date");
    setSaving(true);
    try {
      await upsertEmailCost(editing);
      setEditing(null);
      toast.success("Cost saved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save cost");
    } finally {
      setSaving(false);
    }
  }

  async function removeCost(c: EmailCost) {
    if (!confirm(`Delete "${c.name}"?`)) return;
    try {
      await deleteEmailCost(c.id);
      toast.success("Cost deleted");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete cost");
    }
  }

  const monthlySubs = costs
    .filter((c) => c.frequency === "monthly" && (!c.end_date || c.end_date >= today()))
    .reduce((s, c) => s + c.amount, 0);
  const paid30 = costs.reduce((s, c) => s + costOverRange(c, daysAgo(29), today()), 0);
  const apify30 = autoCosts.filter((a) => a.date >= daysAgo(29)).reduce((s, a) => s + a.amount, 0);

  if (loading) return <div className="text-sm text-muted-foreground">Loading cold email data…</div>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <Button key={r.id} size="sm" variant={range === r.id ? "default" : "outline"} onClick={() => setRange(r.id)}>
            {r.label}
          </Button>
        ))}
        <Select className="ml-auto w-64" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="all">All campaigns</option>
          {campaignNames.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>
      </div>

      {daily.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          No cold email data yet. It's filled in each morning after the 10am pipeline run (or run{" "}
          <code>python3 email_tracker_sync.py</code> in ~/Systemised/pipeline).
        </div>
      )}

      {health.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Possible burned inboxes</div>
            {health.map((h) => (
              <div key={h.name}>
                {h.name}: replies per lead {(h.recent * 100).toFixed(1)}% this week vs {(h.base * 100).toFixed(1)}% normal.
                Run an inbox placement test before changing copy.
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi label="Leads contacted" value={fmtN(shown.leads)} sub={`${fmtN(shown.sent)} emails sent`} />
        <Kpi label="Replies" value={fmtN(shown.replies)} sub={`${pct(shown.replies, shown.leads)} of leads`} />
        <Kpi label="Positive replies" value={fmtN(shown.positive)} sub={`${pct(shown.positive, shown.leads)} of leads`} />
        <Kpi label="Meetings booked" value={fmtN(shown.booked)} sub={`${pct(shown.booked, shown.positive)} of positives`} />
        <Kpi
          label="Cost"
          value={fmt$(shownCost)}
          sub={
            campaign === "all"
              ? `${fmt$(totalCost.manual)} paid + ${fmt$(totalCost.auto)} Apify`
              : "share by emails sent"
          }
        />
        <Kpi label="Cost / booked call" value={fmt$(per(shownCost, shown.booked))} sub={`${fmt$(per(shownCost, shown.positive))} / positive · ${fmt$(per(shownCost, shown.leads))} / lead`} />
      </div>

      <Panel title="By campaign">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Campaign</th>
                <th className="py-2 pr-4 text-right">Leads</th>
                <th className="py-2 pr-4 text-right">Sent</th>
                <th className="py-2 pr-4 text-right">Reply %</th>
                <th className="py-2 pr-4 text-right">Positive</th>
                <th className="py-2 pr-4 text-right">Positive %</th>
                <th className="py-2 pr-4 text-right">Booked</th>
                <th className="py-2 pr-4 text-right">Cost</th>
                <th className="py-2 text-right">Cost / booked</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.map(([id, t]) => (
                <tr key={id} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">{t.name}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(t.leads)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(t.sent)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{pct(t.replies, t.leads)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(t.positive)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{pct(t.positive, t.leads)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(t.booked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmt$(share(t.sent))}</td>
                  <td className="py-2 text-right tabular-nums">{fmt$(per(share(t.sent), t.booked))}</td>
                </tr>
              ))}
              {byCampaign.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-muted-foreground">
                    No sends in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Weekly batches (by week the leads were added)">
        <p className="mb-3 text-xs text-muted-foreground">
          How each week's leads performed overall, whichever day they replied. The fairest way to compare lists and
          copy. Give a week 7+ days before judging it.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Week of</th>
                <th className="py-2 pr-4 text-right">Leads</th>
                <th className="py-2 pr-4 text-right">Replied</th>
                <th className="py-2 pr-4 text-right">Positive</th>
                <th className="py-2 pr-4 text-right">Booked</th>
                <th className="py-2 text-right">Booked per 1,000</th>
              </tr>
            </thead>
            <tbody>
              {cohortRows.map(([week, r]) => (
                <tr key={week} className="border-t border-border">
                  <td className="py-2 pr-4 font-medium">
                    {week}
                    {dayCount(week, today()) < 14 && (
                      <Badge tone="muted" className="ml-2">
                        still landing
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(r.leads)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtN(r.replied)} <span className="text-muted-foreground">({pct(r.replied, r.leads)})</span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtN(r.positive)} <span className="text-muted-foreground">({pct(r.positive, r.leads)})</span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{fmtN(r.booked)}</td>
                  <td className="py-2 text-right tabular-nums">{r.leads ? ((r.booked / r.leads) * 1000).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Costs"
        action={
          <Button size="sm" onClick={() => setEditing({ ...BLANK_COST })}>
            <Plus size={14} /> Add cost
          </Button>
        }
      >
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Kpi label="Paid, last 30 days" value={fmt$(paid30 + apify30)} sub={`${fmt$(paid30)} bills + ${fmt$(apify30)} Apify`} />
          <Kpi label="Monthly subscriptions" value={fmt$(monthlySubs)} sub="charged again each month" />
          <Kpi label="Apify, last 30 days" value={fmt$(apify30)} sub="pulled automatically" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4 text-right">Amount</th>
                <th className="py-2 pr-4">Billed</th>
                <th className="py-2 pr-4">From</th>
                <th className="py-2 pr-4">Until</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {[...costs]
                .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
                .map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">
                      {c.name}
                      {c.notes && <div className="text-xs text-muted-foreground">{c.notes}</div>}
                    </td>
                    <td className="py-2 pr-4">{c.category}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{fmt$(c.amount)}</td>
                    <td className="py-2 pr-4">{c.frequency}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.start_date}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.end_date || (c.frequency === "one-off" ? "" : "ongoing")}</td>
                    <td className="py-2 text-right">
                      <Button size="icon" variant="ghost" aria-label="Edit cost" onClick={() => setEditing({ ...c })}>
                        <Pencil size={14} />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label="Delete cost" onClick={() => removeCost(c)}>
                        <Trash2 size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              {costs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-muted-foreground">
                    No costs added yet. Add Instantly, inboxes, domains, AI Ark and so on to get cost per booked call.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={!!editing}
        title={editing?.id ? "Edit cost" : "Add cost"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveCost} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name</Label>
              <Input value={editing.name} placeholder="e.g. Instantly Hypergrowth" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Category</Label>
                <Select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {EMAIL_COST_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Billed</Label>
                <Select
                  value={editing.frequency}
                  onChange={(e) => setEditing({ ...editing, frequency: e.target.value as NewEmailCost["frequency"] })}
                >
                  {EMAIL_COST_FREQUENCIES.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Amount ($ per {editing.frequency === "yearly" ? "year" : editing.frequency === "monthly" ? "month" : "payment"})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editing.amount || ""}
                onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>{editing.frequency === "one-off" ? "Date" : "Started"}</Label>
                <Input type="date" value={editing.start_date} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} />
              </div>
              {editing.frequency !== "one-off" && (
                <div className="flex flex-col gap-1.5">
                  <Label>Ended (blank = still running)</Label>
                  <Input type="date" value={editing.end_date} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
