import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { fetchAll, upsertClient, deleteClient } from "../lib/api";
import { CLIENT_STATUSES, type Client, type ClientStatus, type NewClient } from "../lib/types";
import { Badge, Button, Input, Kpi, Label, Modal, Select, Textarea } from "../components/ui";

const STATUS_TONE: Record<ClientStatus, "green" | "yellow" | "muted" | "blue"> = {
  Active: "green",
  Paused: "yellow",
  Churned: "muted",
  "One Time": "blue",
};

const fmt$ = (n: number) => "$" + Math.round(n || 0).toLocaleString();

function monthsActive(start: string, end: string | null): number {
  if (!start) return 0;
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  return Math.max(0, months);
}

function emptyClient(): NewClient {
  return {
    name: "",
    contact_name: "",
    status: "Active",
    monthly_value: 0,
    cash_collected: 0,
    start_date: new Date().toISOString().slice(0, 10),
    churn_date: "",
    notes: "",
    refunded: false,
    refund_amount: 0,
  };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "All">("All");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<NewClient>(emptyClient());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setClients(data.clients);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load clients");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => clients.filter((c) => statusFilter === "All" || c.status === statusFilter),
    [clients, statusFilter]
  );

  const kpis = useMemo(() => {
    const active = clients.filter((c) => c.status === "Active");
    const mrr = active.reduce((sum, c) => sum + c.monthly_value, 0);
    const totalCashCollected = clients.reduce((sum, c) => sum + c.cash_collected, 0);
    // One Time deals aren't recurring, so they shouldn't drag down/inflate
    // the recurring-client retention average.
    const recurring = clients.filter((c) => c.status !== "One Time");
    const avgRetentionMonths = recurring.length
      ? recurring.reduce((sum, c) => sum + monthsActive(c.start_date, c.churn_date || null), 0) / recurring.length
      : 0;
    const refundedClients = clients.filter((c) => c.refunded);
    const refundRate = clients.length ? Math.round((refundedClients.length / clients.length) * 100) : null;
    const amountRefunded = clients.reduce((sum, c) => sum + (c.refund_amount || 0), 0);
    // Actual LTV: total cash collected spread across every client, not the
    // running total itself (that's just cumulative revenue, not a per-client
    // figure).
    const avgLtv = clients.length ? totalCashCollected / clients.length : 0;
    return {
      activeCount: active.length,
      mrr,
      totalCashCollected,
      avgRetentionMonths,
      refundRate,
      amountRefunded,
      avgLtv,
    };
  }, [clients]);

  function openAdd() {
    setEditing(null);
    setForm(emptyClient());
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setForm({ ...client });
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error("Client name is required");
      return;
    }
    setSaving(true);
    try {
      await upsertClient({ ...form, id: editing?.id });
      toast.success(editing ? "Client updated" : "Client added");
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(client: Client) {
    if (!confirm(`Delete ${client.name}? This can't be undone.`)) return;
    try {
      await deleteClient(client.id);
      setClients((prev) => prev.filter((c) => c.id !== client.id));
      toast.success("Client deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Active Clients" value={kpis.activeCount} />
        <Kpi label="MRR" value={fmt$(kpis.mrr)} sub="active clients only" />
        <Kpi label="Total Cash Collected" value={fmt$(kpis.totalCashCollected)} />
        <Kpi label="Avg. Retention" value={`${kpis.avgRetentionMonths.toFixed(1)} mo`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Refund Rate" value={kpis.refundRate === null ? "—" : `${kpis.refundRate}%`} sub="of all clients" />
        <Kpi label="Amount Refunded" value={fmt$(kpis.amountRefunded)} />
        <Kpi label="Avg. LTV" value={fmt$(kpis.avgLtv)} sub="cash collected / clients" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-1">
          {(["All", ...CLIENT_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition " +
                (statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground")
              }
            >
              {s}
            </button>
          ))}
        </div>
        <Button onClick={openAdd} size="sm" className="ml-auto">
          + Add Client
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">MRR</th>
              <th className="px-3 py-2">Cash Collected (LTV)</th>
              <th className="px-3 py-2">Refunded</th>
              <th className="px-3 py-2">Retention</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No clients yet.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.name}</div>
                    {c.contact_name && (
                      <div className="text-xs text-muted-foreground">{c.contact_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  </td>
                  <td className="px-3 py-2">{c.monthly_value ? `${fmt$(c.monthly_value)}/mo` : "—"}</td>
                  <td className="px-3 py-2 font-medium text-emerald-400">{fmt$(c.cash_collected)}</td>
                  <td className="px-3 py-2">
                    {c.refunded ? (
                      <Badge tone="red">{fmt$(c.refund_amount)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {monthsActive(c.start_date, c.churn_date || null)} mo
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.start_date || "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(c)}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        title="Delete"
                        onClick={() => remove(c)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={modalOpen}
        title={editing ? "Edit Client" : "Add Client"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Client / Company</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Contact Name</Label>
              <Input
                value={form.contact_name}
                onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ClientStatus })}
            >
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>MRR ($)</Label>
              <Input
                type="number"
                value={form.monthly_value || ""}
                onChange={(e) => setForm({ ...form, monthly_value: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label>Cash Collected to Date ($)</Label>
              <Input
                type="number"
                value={form.cash_collected || ""}
                onChange={(e) => setForm({ ...form, cash_collected: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Churn Date</Label>
              <Input
                type="date"
                value={form.churn_date}
                onChange={(e) => setForm({ ...form, churn_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.refunded}
              onChange={(e) => setForm({ ...form, refunded: e.target.checked })}
            />
            Refunded
          </label>
          {form.refunded && (
            <div>
              <Label>Refund Amount ($)</Label>
              <Input
                type="number"
                value={form.refund_amount || ""}
                onChange={(e) => setForm({ ...form, refund_amount: parseFloat(e.target.value) || 0 })}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
