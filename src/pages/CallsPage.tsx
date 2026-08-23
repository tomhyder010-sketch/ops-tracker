import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, LayoutGrid, Pencil, Table as TableIcon, Trash2 } from "lucide-react";
import { fetchAll, upsertCall, deleteCall } from "../lib/api";
import {
  CALL_QUALIFIED_OPTIONS,
  CALL_SOURCE_SUGGESTIONS,
  CALL_STATUSES,
  CALL_TEMPERATURES,
  type Call,
  type CallQualified,
  type CallStatus,
  type CallTemperature,
  type NewCall,
} from "../lib/types";
import { Badge, Button, Input, Kpi, Label, Modal, Select, Textarea } from "../components/ui";

// Text color for each pipeline column header, matching the Badge tones used
// elsewhere (blue/default/red/green/muted).
const STATUS_HEADER_COLOR: Record<CallStatus, string> = {
  Booked: "text-sky-400",
  Cancelled: "text-muted-foreground",
  Shown: "text-primary",
  "No Show": "text-red-400",
  Closed: "text-emerald-400",
};

const TEMPERATURE_TONE: Record<Exclude<CallTemperature, "">, "yellow" | "blue" | "red"> = {
  Warm: "yellow",
  Cold: "blue",
  Lost: "red",
};

const QUALIFIED_TONE: Record<Exclude<CallQualified, "">, "green" | "muted"> = {
  Qualified: "green",
  "Not Qualified": "muted",
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
    temperature: "",
    qualified: "",
  };
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CallStatus | "All">("All");
  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [view, setView] = useState<"pipeline" | "table">("pipeline");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Call | null>(null);
  const [form, setForm] = useState<NewCall>(emptyCall());
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<CallStatus | null>(null);

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
    if (status === call.status) return;
    setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, status } : c)));
    try {
      await upsertCall({ ...call, status });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
      load();
    }
  }

  async function setTemperature(call: Call, temperature: CallTemperature) {
    setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, temperature } : c)));
    try {
      await upsertCall({ ...call, temperature });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
      load();
    }
  }

  async function setQualified(call: Call, qualified: CallQualified) {
    setCalls((prev) => prev.map((c) => (c.id === call.id ? { ...c, qualified } : c)));
    try {
      await upsertCall({ ...call, qualified });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
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
        {view === "table" && (
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
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={hideDuplicates}
            onChange={(e) => setHideDuplicates(e.target.checked)}
          />
          Hide duplicates {duplicateCount > 0 ? `(${duplicateCount})` : ""}
        </label>
        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            onClick={() => setView("pipeline")}
            title="Pipeline view"
            className={
              "rounded-md p-1.5 transition " +
              (view === "pipeline" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
            }
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setView("table")}
            title="Table view"
            className={
              "rounded-md p-1.5 transition " +
              (view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
            }
          >
            <TableIcon size={15} />
          </button>
        </div>
        <Button onClick={openAdd} size="sm">
          + Add Call
        </Button>
      </div>

      {view === "pipeline" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {CALL_STATUSES.map((status) => {
            const colCalls = filtered.filter((c) => c.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(status);
                }}
                onDragLeave={() => setDragOverCol((prev) => (prev === status ? null : prev))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverCol(null);
                  const call = calls.find((c) => c.id === dragId);
                  if (call) setStatus(call, status);
                  setDragId(null);
                }}
                className={
                  "flex w-72 shrink-0 flex-col rounded-lg border bg-card transition " +
                  (dragOverCol === status ? "border-primary bg-primary/5" : "border-border")
                }
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className={"text-xs font-bold uppercase tracking-wide " + STATUS_HEADER_COLOR[status]}>
                    {status}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {colCalls.length}
                  </span>
                </div>
                <div className="flex min-h-[120px] flex-col gap-2 overflow-y-auto p-2" style={{ maxHeight: "calc(100vh - 340px)" }}>
                  {colCalls.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => openEdit(c)}
                      className={
                        "cursor-grab rounded-lg border border-border bg-background p-3 transition hover:border-primary/50 active:cursor-grabbing " +
                        (c.is_duplicate ? "opacity-50" : "")
                      }
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold">{c.invitee_name || "—"}</span>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {c.temperature && (
                            <Badge tone={TEMPERATURE_TONE[c.temperature]}>{c.temperature}</Badge>
                          )}
                          {c.qualified && (
                            <Badge tone={QUALIFIED_TONE[c.qualified]}>{c.qualified}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{c.location || c.invitee_email}</div>
                      {c.value > 0 && (
                        <div className="mt-1 text-xs font-semibold text-emerald-400">{fmt$(c.value)} collected</div>
                      )}
                      {c.notes && (
                        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{c.notes}</div>
                      )}
                      {c.is_duplicate && (
                        <div className="mt-2">
                          <Badge tone="yellow">Duplicate</Badge>
                        </div>
                      )}
                    </div>
                  ))}
                  {colCalls.length === 0 && (
                    <div className="px-1 py-4 text-center text-xs text-muted-foreground">No calls</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
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
                <th className="px-3 py-2">Temp</th>
                <th className="px-3 py-2">Qualified</th>
                <th className="px-3 py-2">Cash Collected</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
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
                    <td className="px-3 py-2">
                      <Select
                        value={c.temperature}
                        onChange={(e) => setTemperature(c, e.target.value as CallTemperature)}
                        className="h-8 w-auto py-1 text-xs"
                      >
                        {CALL_TEMPERATURES.map((t) => (
                          <option key={t} value={t}>
                            {t || "—"}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={c.qualified}
                        onChange={(e) => setQualified(c, e.target.value as CallQualified)}
                        className="h-8 w-auto py-1 text-xs"
                      >
                        {CALL_QUALIFIED_OPTIONS.map((q) => (
                          <option key={q} value={q}>
                            {q || "—"}
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
      )}

      <Modal
        open={modalOpen}
        title={editing ? "Edit Call" : "Add Call"}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            {editing && (
              <Button
                variant="destructive"
                className="mr-auto"
                onClick={() => {
                  setModalOpen(false);
                  remove(editing);
                }}
              >
                <Trash2 size={14} />
                Delete
              </Button>
            )}
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
              <Label>Follow-up</Label>
              <Select
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: e.target.value as CallTemperature })}
              >
                {CALL_TEMPERATURES.map((t) => (
                  <option key={t} value={t}>
                    {t || "Not set"}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Qualified?</Label>
              <Select
                value={form.qualified}
                onChange={(e) => setForm({ ...form, qualified: e.target.value as CallQualified })}
              >
                {CALL_QUALIFIED_OPTIONS.map((q) => (
                  <option key={q} value={q}>
                    {q || "Not set"}
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
