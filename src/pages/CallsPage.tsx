import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { fetchAll, upsertCall, deleteCall } from "../lib/api";
import {
  CALL_SOURCE_SUGGESTIONS,
  CALL_STATUSES,
  type Call,
  type CallStatus,
  type NewCall,
} from "../lib/types";
import { Badge, Button, Input, Kpi, Label, Modal, Select, Textarea } from "../components/ui";

const STATUS_TONE: Record<CallStatus, "muted" | "blue" | "red" | "green" | "default"> = {
  Booked: "blue",
  Cancelled: "muted",
  Shown: "default",
  "No Show": "red",
  Closed: "green",
};

const fmt$ = (n: number) => (n ? "$" + n.toLocaleString() : "—");

function emptyCall(): NewCall {
  return {
    start_time: "",
    booked_at: new Date().toISOString().slice(0, 16),
    invitee_name: "",
    invitee_email: "",
    invitee_phone: "",
    source: "Manual",
    event_type: "",
    campaign: "",
    status: "Booked",
    value: 0,
    is_duplicate: false,
    notes: "",
    meta_campaign_name: "",
    location: "",
  };
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CallStatus | "All">("All");
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Call | null>(null);
  const [form, setForm] = useState<NewCall>(emptyCall());
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setCalls(
        [...data.calls].sort((a, b) => (b.start_time || "").localeCompare(a.start_time || ""))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const sourceOptions = useMemo(() => {
    const fromData = new Set(calls.map((c) => c.source).filter(Boolean));
    CALL_SOURCE_SUGGESTIONS.forEach((s) => fromData.add(s));
    return Array.from(fromData);
  }, [calls]);

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      if (hideDuplicates && c.is_duplicate) return false;
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.invitee_name} ${c.invitee_email} ${c.invitee_phone}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [calls, statusFilter, hideDuplicates, search]);

  const kpis = useMemo(() => {
    const live = calls.filter((c) => !c.is_duplicate);
    const shownOrLater = live.filter((c) => c.status === "Shown" || c.status === "Closed");
    const noShow = live.filter((c) => c.status === "No Show");
    const closed = live.filter((c) => c.status === "Closed");
    const showDenom = shownOrLater.length + noShow.length;
    const showRate = showDenom ? Math.round((shownOrLater.length / showDenom) * 100) : null;
    const closeRate = shownOrLater.length
      ? Math.round((closed.length / shownOrLater.length) * 100)
      : null;
    // Cash Collected is now a standalone $ field on every call (not tied to
    // a status), so this sums it across all live calls regardless of status.
    const cashCollected = live.reduce((sum, c) => sum + (c.value || 0), 0);
    return {
      total: live.length,
      showRate,
      closeRate,
      cashCollected,
    };
  }, [calls]);

  function openAdd() {
    setEditing(null);
    setForm(emptyCall());
    setModalOpen(true);
  }

  function openEdit(call: Call) {
    setEditing(call);
    setForm({ ...call });
    setModalOpen(true);
  }

  async function save() {
    if (!form.invitee_name.trim()) {
      toast.error("Invitee name is required");
      return;
    }
    setSaving(true);
    try {
      await upsertCall({ ...form, id: editing?.id });
      toast.success(editing ? "Call updated" : "Call added");
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(call: Call, status: CallStatus) {
    setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, status } : c)));
    try {
      await upsertCall({ ...call, status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
      load();
    }
  }

  async function toggleDuplicate(call: Call) {
    const is_duplicate = !call.is_duplicate;
    setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, is_duplicate } : c)));
    try {
      await upsertCall({ ...call, is_duplicate });
      toast.success(is_duplicate ? "Marked as duplicate" : "Unmarked as duplicate");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
      load();
    }
  }

  async function remove(call: Call) {
    if (!confirm(`Delete the call with ${call.invitee_name || "this invitee"}? This can't be undone.`)) return;
    try {
      await deleteCall(call.id);
      setCalls((prev) => prev.filter((c) => c.id !== call.id));
      toast.success("Call deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const duplicateCount = calls.filter((c) => c.is_duplicate).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Booked Calls" value={kpis.total} />
        <Kpi label="Show Rate" value={kpis.showRate === null ? "—" : `${kpis.showRate}%`} />
        <Kpi label="Close Rate" value={kpis.closeRate === null ? "—" : `${kpis.closeRate}%`} sub="of shown" />
        <Kpi label="Cash Collected" value={fmt$(kpis.cashCollected)} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <div className="flex items-center gap-1">
          {(["All", ...CALL_STATUSES] as const).map((s) => (
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
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideDuplicates}
            onChange={(e) => setHideDuplicates(e.target.checked)}
          />
          Hide duplicates {duplicateCount > 0 ? `(${duplicateCount})` : ""}
        </label>
        <Button onClick={openAdd} size="sm">
          + Add Call
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Call Time</th>
              <th className="px-3 py-2">Invitee</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Event Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Cash Collected</th>
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
                  No calls match your filters.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((c) => (
                <tr
                  key={c.id}
                  className={"border-b border-border last:border-0 " + (c.is_duplicate ? "opacity-50" : "")}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {c.start_time ? new Date(c.start_time).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.invitee_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.invitee_email}
                      {c.invitee_phone ? ` · ${c.invitee_phone}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.location || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.source || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{c.event_type || "—"}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={c.status}
                      onChange={(e) => setStatus(c, e.target.value as CallStatus)}
                      className="h-8 w-auto py-1 text-xs"
                    >
                      {CALL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">{fmt$(c.value)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {c.is_duplicate && <Badge tone="yellow">Duplicate</Badge>}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={c.is_duplicate ? "Unmark duplicate" : "Mark as duplicate"}
                        onClick={() => toggleDuplicate(c)}
                      >
                        <Copy size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Edit"
                        onClick={() => openEdit(c)}
                      >
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
        title={editing ? "Edit Call" : "Add Call"}
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
          <div>
            <Label>Invitee Name</Label>
            <Input
              value={form.invitee_name}
              onChange={(e) => setForm({ ...form, invitee_name: e.target.value })}
              placeholder="First Last"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input
                value={form.invitee_email}
                onChange={(e) => setForm({ ...form, invitee_email: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={form.invitee_phone}
                onChange={(e) => setForm({ ...form, invitee_phone: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Call Time</Label>
              <Input
                type="datetime-local"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
              />
            </div>
            <div>
              <Label>Booked At</Label>
              <Input
                type="datetime-local"
                value={form.booked_at}
                onChange={(e) => setForm({ ...form, booked_at: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Source</Label>
              <Input
                list="source-suggestions"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
              />
              <datalist id="source-suggestions">
                {sourceOptions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Event Type</Label>
              <Input
                value={form.event_type}
                onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                placeholder="30 Min Strategy Call"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as CallStatus })}
              >
                {CALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Cash Collected ($)</Label>
              <Input
                type="number"
                value={form.value || ""}
                onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Location</Label>
              <Input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="US (Eastern), Canada, UK…"
              />
            </div>
            <div>
              <Label>Campaign / Ad (optional)</Label>
              <Input
                value={form.campaign}
                onChange={(e) => setForm({ ...form, campaign: e.target.value })}
                placeholder="For matching against Meta Ads later"
              />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_duplicate}
              onChange={(e) => setForm({ ...form, is_duplicate: e.target.checked })}
            />
            Mark as duplicate
          </label>
        </div>
      </Modal>
    </div>
  );
}
