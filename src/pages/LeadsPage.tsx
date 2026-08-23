import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchAll, isConfigured } from "../lib/api";
import { HIDDEN_ANSWER_KEYS, QUESTIONNAIRE_NAMES, type Call, type Lead } from "../lib/types";
import { Badge, Kpi, Panel } from "../components/ui";

const digitsOnly = (s: string) => s.replace(/\D/g, "");

// Applications don't have a dedicated phone column — it's one of the
// dynamic question/answer pairs. Scan for a question that looks
// phone-related, same heuristic the existing calendly-webhook function
// uses to find a phone number in Calendly's Q&A.
function extractPhone(answers: Record<string, unknown>): string {
  for (const [question, answer] of Object.entries(answers)) {
    if (/phone|number/i.test(question) && typeof answer === "string" && answer.trim()) {
      return answer.trim();
    }
  }
  return "";
}

function parseAnswers(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const data = await fetchAll();
      setLeads(
        [...data.leads].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      );
      setCalls(data.calls);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const callEmails = useMemo(
    () => new Set(calls.filter((c) => !c.is_duplicate).map((c) => c.invitee_email.toLowerCase())),
    [calls]
  );
  const callPhones = useMemo(
    () =>
      new Set(
        calls
          .filter((c) => !c.is_duplicate && c.invitee_phone)
          .map((c) => digitsOnly(c.invitee_phone))
      ),
    [calls]
  );

  const rows = useMemo(() => {
    return leads.map((lead) => {
      const answers = parseAnswers(lead.answers);
      const phone = extractPhone(answers);
      const byEmail = lead.email && callEmails.has(lead.email.toLowerCase());
      const byPhone = phone && callPhones.has(digitsOnly(phone));
      return { lead, answers, phone, booked: Boolean(byEmail || byPhone) };
    });
  }, [leads, callEmails, callPhones]);

  const totals = useMemo(() => {
    const booked = rows.filter((r) => r.booked).length;
    return {
      total: rows.length,
      booked,
      rate: rows.length ? Math.round((booked / rows.length) * 100) : null,
    };
  }, [rows]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {!isConfigured() && (
        <Panel title="Not connected">
          <p className="text-sm text-muted-foreground">
            Leads come from the Sheet backend via the Lovable webhook — connect it first (see README).
          </p>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Total Leads" value={totals.total} />
        <Kpi label="Booked a Call" value={totals.booked} />
        <Kpi label="Lead → Call Rate" value={totals.rate === null ? "—" : `${totals.rate}%`} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Applied</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email / Phone</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Application</th>
              <th className="px-3 py-2">Booked?</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No leads yet — they'll show up here as applications come in from the site.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map(({ lead, answers, phone, booked }) => {
                const isOpen = expanded.has(lead.id);
                const answerEntries = Object.entries(answers).filter(
                  ([question]) => !HIDDEN_ANSWER_KEYS.includes(question)
                );
                return (
                  <Fragment key={lead.id}>
                    <tr
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/40"
                      onClick={() => toggle(lead.id)}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {lead.created_at ? new Date(lead.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2 font-medium">{lead.name || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {lead.email || "—"}
                        {phone ? ` · ${phone}` : ""}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{lead.location || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {QUESTIONNAIRE_NAMES[lead.questionnaire_id] || lead.questionnaire_id || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={booked ? "green" : "muted"}>{booked ? "Booked" : "Not booked"}</Badge>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border last:border-0 bg-accent/20">
                        <td />
                        <td colSpan={6} className="px-3 py-3">
                          {answerEntries.length === 0 ? (
                            <span className="text-xs text-muted-foreground">No answers recorded.</span>
                          ) : (
                            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                              {answerEntries.map(([question, answer]) => (
                                <div key={question}>
                                  <dt className="text-xs font-semibold text-muted-foreground">{question}</dt>
                                  <dd className="text-sm">{String(answer)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
