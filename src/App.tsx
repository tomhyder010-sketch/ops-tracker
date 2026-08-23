import { useEffect, useState } from "react";
import { ClipboardList, Megaphone, PhoneCall, Users } from "lucide-react";
import { isConfigured } from "./lib/api";
import CallsPage from "./pages/CallsPage";
import ClientsPage from "./pages/ClientsPage";
import CampaignsPage from "./pages/CampaignsPage";
import LeadsPage from "./pages/LeadsPage";

type Tab = "leads" | "calls" | "clients" | "campaigns";

const TABS: { id: Tab; label: string; icon: typeof PhoneCall }[] = [
  { id: "leads", label: "Leads", icon: ClipboardList },
  { id: "calls", label: "Booked Calls", icon: PhoneCall },
  { id: "clients", label: "Clients", icon: Users },
  { id: "campaigns", label: "Ad Campaigns", icon: Megaphone },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("calls");
  const [configured, setConfigured] = useState(isConfigured());

  useEffect(() => {
    setConfigured(isConfigured());
  }, [tab]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
        <h1 className="text-base font-bold tracking-tight">
          Systemised <span className="text-primary">Scaling</span>
          <span className="ml-2 font-normal text-muted-foreground">Tracker</span>
        </h1>
        {!configured && (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
            Local mode — not connected to a shared Sheet yet (see README)
          </span>
        )}
      </header>

      <nav className="flex items-center gap-1 border-b border-border bg-card px-4 py-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition " +
              (tab === id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground")
            }
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>

      <main className="p-5">
        {tab === "leads" && <LeadsPage />}
        {tab === "calls" && <CallsPage />}
        {tab === "clients" && <ClientsPage />}
        {tab === "campaigns" && <CampaignsPage />}
      </main>
    </div>
  );
}
