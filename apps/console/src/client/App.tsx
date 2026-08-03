import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TerminalSquare,
  X,
} from "lucide-react";
import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";
import { api, type Overview } from "./api.js";
import { getAddress, signMessage } from "@stellar/freighter-api";

type View = "overview" | "command";

function short(value: string, front = 7): string {
  return value.length > 18 ? `${value.slice(0, front)}...${value.slice(-6)}` : value;
}

function amount(value: string): string {
  const atomic = BigInt(value);
  const divisor = 10_000_000n;
  const fraction = (atomic % divisor).toString().padStart(7, "0").replace(/0+$/, "");
  return fraction ? `${atomic / divisor}.${fraction}` : String(atomic / divisor);
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="address">
      <code title={value}>{short(value)}</code>
      <button
        className="icon-button small"
        title={copied ? "Copied" : "Copy full address"}
        aria-label="Copy full address"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
      >{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </span>
  );
}

function Status({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("active") || normalized.includes("unlock") || normalized.includes("allow")
    ? "success"
    : normalized.includes("pending") || normalized.includes("unknown")
      ? "warning"
      : normalized.includes("block") || normalized.includes("revoke") || normalized.includes("expire") || normalized.includes("error")
        ? "danger"
        : "neutral";
  return <span className={`status ${tone}`}><span aria-hidden="true" />{value.replaceAll("_", " ")}</span>;
}

export function App() {
  const [overview, setOverview] = useState<Overview>();
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState("1");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [ownerAddress, setOwnerAddress] = useState<string>();
  const [ownerBusy, setOwnerBusy] = useState(false);
  const connectOwner = async () => {
    setOwnerBusy(true); setError(undefined);
    try {
      const address = await getAddress();
      if (address.error || !address.address) throw new Error(address.error?.message ?? "Freighter did not return an address");
      const challenge = await api.ownerChallenge();
      if (challenge.admin && challenge.admin !== address.address) throw new Error("Connected wallet is not the treasury admin");
      const signed = await signMessage(challenge.message, { address: address.address });
      const raw = signed.signedMessage;
      if (!raw) throw new Error(signed.error?.message ?? "Wallet signature was rejected");
      const signature = typeof raw === "string"
        ? raw
        : btoa(Array.from(raw, (byte) => String.fromCharCode(byte)).join(""));
      await api.ownerLogin({ nonce: challenge.nonce, address: address.address, signature });
      setOwnerAddress(address.address);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Wallet login failed"); }
    finally { setOwnerBusy(false); }
  };

  const refresh = async () => {
    setError(undefined);
    try {
      const value = await api.overview();
      setOverview(value);
      if (!value.allowances.some((item) => item.allowanceId === selectedId)) {
        setSelectedId(value.allowances[0]?.allowanceId ?? "");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load console data");
    }
  };
  useEffect(() => { void refresh(); }, []);

  const selected = overview?.allowances.find((item) => item.allowanceId === selectedId);
  const totals = useMemo(() => ({
    active: overview?.allowances.filter((item) => item.status === "ACTIVE").length ?? 0,
    blocked: overview?.attempts.filter((item) => item.decision === "BLOCK").length ?? 0,
    settled: overview?.attempts.filter((item) => item.state === "SETTLED" || item.state === "UNLOCKED").length ?? 0,
    spent: overview?.allowances.reduce((sum, item) => sum + BigInt(item.spentAtomic), 0n) ?? 0n,
  }), [overview]);

  const run = async (scenario: "success" | "over-limit" | "unapproved-recipient") => {
    if (!ownerAddress) {
      await connectOwner();
      return;
    }
    if (!selected) return;
    setBusy(scenario);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await api.run(selected.allowanceId, scenario);
      setResult(response.ok ? "PAID_AND_UNLOCKED" : response.reason ?? "POLICY_BLOCKED");
    } catch (reason) {
      setResult(reason instanceof Error ? reason.message : "POLICY_BLOCKED");
    } finally {
      setBusy(undefined);
      await refresh();
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><ShieldCheck size={25} /><span>AgentAllowance</span></div>
        <nav aria-label="Primary navigation">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
            <LayoutDashboard size={18} />Overview
          </button>
          <button className={view === "command" ? "active" : ""} onClick={() => setView("command")}>
            <TerminalSquare size={18} />Command Center
          </button>
        </nav>
        <div className="sidebar-note">
          <AlertTriangle size={16} />
          <span>Testnet prototype<br />Unaudited contracts</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">STELLAR TESTNET</p>
            <h1>{view === "overview" ? "Treasury overview" : "Live command center"}</h1>
          </div>
          <div className="topbar-actions">
            <span className="rpc-state"><span />RPC connected</span>
            <button className="icon-button" title="Refresh chain state" aria-label="Refresh chain state" onClick={() => void refresh()}>
              <RefreshCw size={17} />
            </button>
            {ownerAddress
              ? <button className="primary" onClick={() => setCreateOpen(true)}><Plus size={17} />Create allowance</button>
              : <button className="primary" disabled={ownerBusy} onClick={() => void connectOwner()}><LogIn size={17} />{ownerBusy ? "Connecting..." : "Connect Freighter"}</button>}
          </div>
        </header>

        {error && <div className="alert"><AlertTriangle size={17} />{error}</div>}
        {!overview ? <div className="loading"><LoaderCircle className="spin" />Loading chain state</div> : view === "overview" ? (
          <OverviewView
            overview={overview}
            totals={totals}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRevoke={async (allowance) => {
              if (!ownerAddress) {
                await connectOwner();
                return;
              }
              if (!window.confirm(`Revoke allowance #${allowance.allowanceId} for ${allowance.delegatedSigner}?`)) return;
              setBusy(`revoke-${allowance.allowanceId}`);
              try { await api.revoke(allowance); } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Revoke failed");
              } finally { setBusy(undefined); await refresh(); }
            }}
            busy={busy}
          />
        ) : (
          <CommandCenter
            overview={overview}
            selectedId={selectedId}
            onSelect={setSelectedId}
            busy={busy}
            result={result}
            onRun={run}
          />
        )}
      </main>

      {createOpen && overview && (
        <CreateAllowanceDialog
          overview={overview}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await refresh(); }}
        />
      )}
    </div>
  );
}

function OverviewView({ overview, totals, selectedId, onSelect, onRevoke, busy }: {
  overview: Overview;
  totals: { active: number; blocked: number; settled: number; spent: bigint };
  selectedId: string;
  onSelect: (id: string) => void;
  onRevoke: (allowance: AllowanceRecord) => Promise<void>;
  busy?: string;
}) {
  return <div className="content">
    <section className="treasury-strip">
      <div><span>Treasury</span><CopyAddress value={overview.treasury} /></div>
      <div><span>Asset contract</span><CopyAddress value={overview.asset} /></div>
      <div><span>Current ledger</span><strong>{overview.currentLedger.toLocaleString()}</strong></div>
      <div><span>Last refreshed</span><strong>{new Date(overview.refreshedAt).toLocaleTimeString()}</strong></div>
    </section>

    <section className="metrics" aria-label="Treasury metrics">
      <article><CircleDollarSign /><div><span>Treasury balance</span><strong>{overview.balanceDisplay} XLM</strong><small>{overview.balanceAtomic} stroops</small></div></article>
      <article><ShieldCheck /><div><span>Active allowances</span><strong>{totals.active}</strong><small>{overview.allowances.length} configured</small></div></article>
      <article><Activity /><div><span>Settled payments</span><strong>{totals.settled}</strong><small>{amount(totals.spent.toString())} XLM tracked</small></div></article>
      <article><ShieldX /><div><span>Policy blocks</span><strong>{totals.blocked}</strong><small>No funds moved</small></div></article>
    </section>

    <section className="section-block">
      <div className="section-heading"><div><h2>Delegated allowances</h2><p>On-chain rule scope, budget and recipient state.</p></div><span>{overview.allowances.length} rules</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Agent</th><th>Signer</th><th>Budget</th><th>Spent</th><th>Recipient</th><th>Expires</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{overview.allowances.map((item) => <tr key={item.allowanceId} className={selectedId === item.allowanceId ? "selected" : ""} onClick={() => onSelect(item.allowanceId)}>
            <td><strong>{item.label}</strong><small>Rule #{item.contextRuleId}</small></td>
            <td><CopyAddress value={item.delegatedSigner} /></td>
            <td>{amount(item.maxSpendAtomic)} XLM</td>
            <td>{amount(item.spentAtomic)} XLM</td>
            <td><CopyAddress value={item.allowedRecipients[0] ?? ""} /></td>
            <td>Ledger {item.validUntilLedger.toLocaleString()}</td>
            <td><Status value={item.status} /></td>
            <td><button className="icon-button small danger-button" title="Revoke allowance" aria-label="Revoke allowance" disabled={item.status === "REVOKED" || busy === `revoke-${item.allowanceId}`} onClick={(event) => { event.stopPropagation(); void onRevoke(item); }}><Ban size={15} /></button></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <AttemptFeed attempts={overview.attempts.slice(0, 6)} />
  </div>;
}

function CommandCenter({ overview, selectedId, onSelect, busy, result, onRun }: {
  overview: Overview;
  selectedId: string;
  onSelect: (id: string) => void;
  busy?: string;
  result?: string;
  onRun: (scenario: "success" | "over-limit" | "unapproved-recipient") => Promise<void>;
}) {
  return <div className="content command-layout">
    <section className="scenario-panel">
      <div className="section-heading"><div><h2>Controlled payment run</h2><p>Each scenario uses the selected on-chain allowance.</p></div></div>
      <label className="field"><span>Allowance</span><select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{overview.allowances.map((item) => <option key={item.allowanceId} value={item.allowanceId}>#{item.allowanceId} - {item.label}</option>)}</select></label>
      <div className="scenario-list">
        <button onClick={() => void onRun("success")} disabled={Boolean(busy)}><span className="scenario-icon success"><ArrowRight /></span><span><strong>Approved payment</strong><small>Exact recipient and amount below remaining budget</small></span>{busy === "success" ? <LoaderCircle className="spin" /> : <ChevronRight />}</button>
        <button onClick={() => void onRun("over-limit")} disabled={Boolean(busy)}><span className="scenario-icon warning"><Gauge /></span><span><strong>Over-limit payment</strong><small>Amount exceeds the rolling spending cap</small></span>{busy === "over-limit" ? <LoaderCircle className="spin" /> : <ChevronRight />}</button>
        <button onClick={() => void onRun("unapproved-recipient")} disabled={Boolean(busy)}><span className="scenario-icon danger"><ShieldX /></span><span><strong>Unapproved recipient</strong><small>payTo differs from the installed recipient policy</small></span>{busy === "unapproved-recipient" ? <LoaderCircle className="spin" /> : <ChevronRight />}</button>
      </div>
      {result && <div className={`run-result ${result.includes("PAID") ? "success" : "danger"}`}><Status value={result.includes("PAID") ? "PAID_AND_UNLOCKED" : "POLICY_BLOCKED"} /><strong>{result}</strong></div>}
    </section>
    <AttemptFeed attempts={overview.attempts} live />
  </div>;
}

function AttemptFeed({ attempts, live = false }: { attempts: PaymentAttempt[]; live?: boolean }) {
  return <section className={`section-block attempt-feed ${live ? "live" : ""}`}>
    <div className="section-heading"><div><h2>{live ? "Live evidence feed" : "Recent evidence"}</h2><p>Normalized decisions with transaction correlation.</p></div>{live && <span className="live-label"><span />LIVE</span>}</div>
    <div className="attempt-list">{attempts.length === 0 ? <div className="empty">No payment attempts recorded.</div> : attempts.map((item) => <article key={item.attemptId}>
      <span className={`timeline-dot ${item.decision.toLowerCase()}`} />
      <div><div className="attempt-title"><Status value={item.state} /><strong>{item.reasonCode ?? (item.state === "UNLOCKED" ? "PAID_AND_UNLOCKED" : item.decision)}</strong></div><p>{amount(item.amountAtomic)} XLM to {short(item.payTo)}</p><small>{new Date(item.updatedAt).toLocaleString()} | Attempt {short(item.attemptId, 8)}</small></div>
      {item.txHash && <a className="tx-link" href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`} target="_blank" rel="noreferrer">View tx <ArrowRight size={14} /></a>}
    </article>)}</div>
  </section>;
}

function CreateAllowanceDialog({ overview, onClose, onCreated }: {
  overview: Overview;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    label: "Data agent",
    delegatedSigner: overview.availableSigners[1] ?? overview.availableSigners[0] ?? "",
    maxSpendAtomic: "500000",
    windowSeconds: 3600,
    recipient: overview.merchant,
    expiresInSeconds: 3600,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <div className="dialog-header"><div><p className="eyebrow">ON-CHAIN ADMIN ACTION</p><h2 id="create-title">Create delegated allowance</h2></div><button className="icon-button" title="Close" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="form-grid">
        <label className="field full"><span>Agent label</span><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
        <label className="field full"><span>Delegated signer</span><select value={form.delegatedSigner} onChange={(e) => setForm({ ...form, delegatedSigner: e.target.value })}>{overview.availableSigners.map((value) => <option key={value} value={value}>{value}</option>)}</select><small>No signer secret enters the browser.</small></label>
        <label className="field"><span>Budget (stroops)</span><input inputMode="numeric" value={form.maxSpendAtomic} onChange={(e) => setForm({ ...form, maxSpendAtomic: e.target.value })} /><small>{/^\d+$/.test(form.maxSpendAtomic) ? amount(form.maxSpendAtomic) : "0"} XLM</small></label>
        <label className="field"><span>Rolling window</span><select value={form.windowSeconds} onChange={(e) => setForm({ ...form, windowSeconds: Number(e.target.value) })}><option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option></select></label>
        <label className="field full"><span>Approved recipient</span><input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} /></label>
        <label className="field full"><span>Permission lifetime</span><select value={form.expiresInSeconds} onChange={(e) => setForm({ ...form, expiresInSeconds: Number(e.target.value) })}><option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option></select></label>
      </div>
      <div className="policy-review"><ShieldCheck size={18} /><div><strong>Exact policy scope</strong><span>SEP-41 transfer | one recipient | rolling cap | delegated signer | ledger expiry</span></div></div>
      {error && <div className="alert"><AlertTriangle size={16} />{error}</div>}
      <div className="dialog-actions"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !form.delegatedSigner} onClick={async () => { setBusy(true); setError(undefined); try { await api.createAllowance(form); await onCreated(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Create failed"); } finally { setBusy(false); } }}>{busy ? <LoaderCircle className="spin" /> : <Plus />}Create on Testnet</button></div>
    </div>
  </div>;
}
