import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Gauge,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  Menu,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TestTube2,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";
import { api, type Overview, type OwnerProfile } from "./api.js";
import { getNetworkDetails, requestAccess, signAuthEntry, signMessage } from "@stellar/freighter-api";
import { Networks } from "@stellar/stellar-sdk";

type ConsoleView = "overview" | "lab" | "evidence";
type Scenario = "success" | "over-limit" | "unapproved-recipient";
type WalletOperationPhase = "preparing" | "signing" | "submitting";

function short(value: string, front = 7): string {
  return value.length > 18 ? `${value.slice(0, front)}...${value.slice(-6)}` : value;
}

function amount(value: string, decimals = 7): string {
  const atomic = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const fraction = (atomic % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${atomic / divisor}.${fraction}` : String(atomic / divisor);
}

function Brand() {
  return <span className="console-brand"><img src="/agentallowance-logo.jpg" alt="" /><span>AgentAllowance</span></span>;
}

function CopyAddress({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="address">
    <code title={value}>{short(value)}</code>
    <button className="copy-button" title={copied ? "Copied" : "Copy full address"} aria-label="Copy full address" onClick={(event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }}>{copied ? <Check /> : <Copy />}</button>
  </span>;
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
  return <span className={`status ${tone}`}><i />{value.replaceAll("_", " ")}</span>;
}

function WalletAction({ ownerAddress, ownerProfile, ownerBusy, onConnect, onOnboard, onCreate }: {
  ownerAddress?: string;
  ownerProfile?: OwnerProfile;
  ownerBusy: boolean;
  onConnect: () => Promise<void>;
  onOnboard: () => Promise<void>;
  onCreate: () => void;
}) {
  if (!ownerAddress) return <button className="wallet-button" aria-label="Connect Freighter" disabled={ownerBusy} onClick={() => void onConnect()}>
    {ownerBusy ? <LoaderCircle className="spin" /> : <LogIn />}<span>{ownerBusy ? "Connecting" : "Connect Freighter"}</span>
  </button>;
  if (!ownerProfile?.onboarded) return <button className="wallet-button ready" aria-label="Create my treasury" disabled={ownerBusy} onClick={() => void onOnboard()}>
    {ownerBusy ? <LoaderCircle className="spin" /> : <WalletCards />}<span>{ownerBusy ? "Deploying treasury" : "Create my treasury"}</span>
  </button>;
  return <button className="wallet-button ready" aria-label="New allowance" onClick={onCreate}><Plus /><span>New allowance</span></button>;
}

export function ConsoleApp({ onExit }: { onExit: () => void }) {
  const [overview, setOverview] = useState<Overview>();
  const [view, setView] = useState<ConsoleView>("overview");
  const [selectedId, setSelectedId] = useState("1");
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AllowanceRecord>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [ownerAddress, setOwnerAddress] = useState<string>();
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile>();
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerSessionChecked, setOwnerSessionChecked] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const connectOwner = async () => {
    setOwnerBusy(true); setError(undefined);
    try {
      const address = await requestAccess();
      if (address.error || !address.address) throw new Error(address.error?.message ?? "Freighter did not return an address");
      const network = await getNetworkDetails();
      if (network.error) throw new Error(network.error.message);
      if (network.networkPassphrase !== Networks.TESTNET) throw new Error("Switch Freighter to Stellar Testnet before connecting");
      const challenge = await api.ownerChallenge(address.address);
      const signed = await signMessage(challenge.message, { address: address.address });
      const raw = signed.signedMessage;
      if (!raw) throw new Error(signed.error?.message ?? "Wallet signature was rejected");
      if (signed.signerAddress !== address.address) throw new Error("Freighter signed with a different address");
      const signature = typeof raw === "string" ? raw : btoa(Array.from(raw, (byte) => String.fromCharCode(byte)).join(""));
      await api.ownerLogin({ nonce: challenge.nonce, address: address.address, signature });
      setOwnerAddress(address.address);
      const profile = await api.ownerProfile();
      setOwnerProfile(profile);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Wallet login failed"); }
    finally { setOwnerBusy(false); }
  };

  const signPreparedAuthorization = async (authPreimageXdr: string): Promise<string> => {
    if (!ownerAddress) throw new Error("Connect your treasury owner wallet first");
    const result = await signAuthEntry(authPreimageXdr, { address: ownerAddress, networkPassphrase: Networks.TESTNET });
    if (result.error || !result.signedAuthEntry) throw new Error(result.error?.message ?? "Wallet authorization was rejected");
    if (result.signerAddress !== ownerAddress) throw new Error("Freighter signed with a different address");
    return result.signedAuthEntry;
  };

  const createWithWallet = async (form: Parameters<typeof api.prepareWalletCreate>[0], onPhase: (phase: WalletOperationPhase) => void) => {
    onPhase("preparing");
    const prepared = await api.prepareWalletCreate(form);
    onPhase("signing");
    const walletSignature = await signPreparedAuthorization(prepared.authPreimageXdr);
    onPhase("submitting");
    return api.submitWalletCreate({ operationId: prepared.operationId, walletSignature });
  };

  const revokeWithWallet = async (allowance: AllowanceRecord, onPhase: (phase: WalletOperationPhase) => void) => {
    onPhase("preparing");
    const prepared = await api.prepareWalletRevoke(allowance.allowanceId);
    onPhase("signing");
    const walletSignature = await signPreparedAuthorization(prepared.authPreimageXdr);
    onPhase("submitting");
    return api.submitWalletRevoke({ operationId: prepared.operationId, walletSignature });
  };

  const refresh = async () => {
    setError(undefined);
    try {
      const value = ownerProfile?.onboarded ? await api.ownerOverview() : await api.overview();
      setOverview(value);
      if (!value.allowances.some((item) => item.allowanceId === selectedId)) setSelectedId(value.allowances[0]?.allowanceId ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load console data"); }
  };
  useEffect(() => {
    let active = true;
    void api.ownerSession()
      .then((session) => {
        if (!active || !session.authenticated) return;
        setOwnerAddress(session.profile.address);
        setOwnerProfile(session.profile);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setOwnerSessionChecked(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (ownerSessionChecked) void refresh(); }, [ownerSessionChecked, ownerProfile?.onboarded]);

  const onboardOwner = async () => {
    setOwnerBusy(true); setError(undefined);
    try {
      const profile = await api.onboardOwner();
      setOwnerProfile(profile);
      setOverview(await api.ownerOverview());
      setSelectedId("1");
      if (profile.fundingError) setError(`Treasury created, but Testnet funding failed: ${profile.fundingError}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Treasury onboarding failed"); }
    finally { setOwnerBusy(false); }
  };

  const selected = overview?.allowances.find((item) => item.allowanceId === selectedId);
  const totals = useMemo(() => ({
    active: overview?.allowances.filter((item) => item.status === "ACTIVE").length ?? 0,
    blocked: overview?.attempts.filter((item) => item.decision === "BLOCK").length ?? 0,
    settled: overview?.attempts.filter((item) => item.state === "SETTLED" || item.state === "UNLOCKED").length ?? 0,
    spent: overview?.allowances.reduce((sum, item) => sum + BigInt(item.spentAtomic), 0n) ?? 0n,
  }), [overview]);

  const run = async (scenario: Scenario) => {
    if (!selected) return;
    setBusy(scenario); setError(undefined); setResult(undefined);
    try {
      const response = ownerProfile?.onboarded ? await api.run(selected.allowanceId, scenario) : await api.runPublic(scenario);
      setResult(response.ok ? "PAID_AND_UNLOCKED" : response.reason ?? "POLICY_BLOCKED");
    } catch (reason) { setResult(reason instanceof Error ? reason.message : "POLICY_BLOCKED"); }
    finally { setBusy(undefined); await refresh(); }
  };

  const navigate = (next: ConsoleView) => { setView(next); setMobileNav(false); };
  const modeLabel = ownerProfile?.onboarded ? "My treasury" : "Public demo";

  return <div className="console-shell">
    <aside className={`console-sidebar ${mobileNav ? "open" : ""}`}>
      <div className="sidebar-brand-row"><Brand /><button aria-label="Close navigation" onClick={() => setMobileNav(false)}><X /></button></div>
      <div className="network-chip"><i />STELLAR TESTNET</div>
      <nav aria-label="App navigation">
        <button className={view === "overview" ? "active" : ""} onClick={() => navigate("overview")}><LayoutDashboard /><span>Overview</span></button>
        <button className={view === "lab" ? "active" : ""} onClick={() => navigate("lab")}><TestTube2 /><span>Payment lab</span></button>
        <button className={view === "evidence" ? "active" : ""} onClick={() => navigate("evidence")}><FileCheck2 /><span>Evidence</span></button>
      </nav>
      <div className="sidebar-system">
        <span>SYSTEM STATUS</span>
        <div><i />RPC connected</div>
        <div><i />Facilitator ready</div>
        <div><i />USDC configured</div>
      </div>
      <button className="back-site" onClick={onExit}><ArrowLeft />Back to site</button>
    </aside>

    <main className="console-main">
      <header className="console-topbar">
        <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu /></button>
        <div key={view} className="topbar-title console-title-transition">
          <span>{view === "overview" ? "CONTROL PLANE" : view === "lab" ? "EXECUTION ENVIRONMENT" : "AUDIT TRAIL"}</span>
          <h1>{view === "overview" ? "Treasury overview" : view === "lab" ? "Payment lab" : "On-chain evidence"}</h1>
        </div>
        <div className="topbar-controls">
          <span className={`mode-badge ${ownerProfile?.onboarded ? "owner" : ""}`}><i />{modeLabel}</span>
          <button className="refresh-button" title="Refresh chain state" aria-label="Refresh chain state" onClick={() => void refresh()}><RefreshCw /></button>
          <WalletAction ownerAddress={ownerAddress} ownerProfile={ownerProfile} ownerBusy={ownerBusy} onConnect={connectOwner} onOnboard={onboardOwner} onCreate={() => setCreateOpen(true)} />
        </div>
      </header>

      {error && <div className="console-alert"><AlertTriangle /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(undefined)}><X /></button></div>}

      {!overview ? <div className="console-loading"><img src="/agentallowance-logo.jpg" alt="" /><LoaderCircle className="spin" /><span>Reading smart-account state</span></div> : <>
        {!ownerAddress && <div className="public-banner"><div><Radio /><span><strong>Public proof mode</strong><small>Inspect and run bounded Testnet scenarios. Connect Freighter to operate your own treasury.</small></span></div><button onClick={() => void connectOwner()}>Switch to my treasury <ArrowRight /></button></div>}
        {ownerAddress && !ownerProfile?.onboarded && <OnboardingPanel ownerAddress={ownerAddress} busy={ownerBusy} onOnboard={onboardOwner} />}
        <div key={view} className="console-view-transition">
          {view === "overview" && <OverviewView overview={overview} totals={totals} selectedId={selectedId} onSelect={setSelectedId} onRevoke={(allowance) => {
            if (!ownerAddress || !ownerProfile?.onboarded) { void connectOwner(); return; }
            setPendingRevoke(allowance);
          }} busy={busy} onOpenLab={() => navigate("lab")} />}
          {view === "lab" && <PaymentLab overview={overview} selectedId={selectedId} onSelect={setSelectedId} busy={busy} result={result} onRun={run} />}
          {view === "evidence" && <EvidenceView overview={overview} />}
        </div>
      </>}
    </main>

    {createOpen && overview && <CreateAllowanceDialog overview={overview} onClose={() => setCreateOpen(false)} onCreated={async (record) => { await refresh(); setSelectedId(record.allowanceId); setView("overview"); }} createAllowance={createWithWallet} />}
    {pendingRevoke && <RevokeDialog allowance={pendingRevoke} onClose={() => setPendingRevoke(undefined)} onRevoked={refresh} revokeAllowance={revokeWithWallet} />}
  </div>;
}

function OnboardingPanel({ ownerAddress, busy, onOnboard }: { ownerAddress: string; busy: boolean; onOnboard: () => Promise<void> }) {
  return <section className="onboarding-panel">
    <div className="onboarding-copy"><span>WALLET VERIFIED</span><h2>Your smart-account treasury is ready to deploy.</h2><p>Freighter remains the admin. AgentAllowance sponsors the Testnet transaction and installs the first bounded rule.</p><div><Fingerprint />{short(ownerAddress, 12)}</div></div>
    <div className="onboarding-flow"><span><Check />Wallet owner</span><i /><span><WalletCards />Treasury</span><i /><span><ShieldCheck />Policies</span></div>
    <button disabled={busy} onClick={() => void onOnboard()}>{busy ? <LoaderCircle className="spin" /> : <Zap />}Deploy on Stellar</button>
  </section>;
}

function OverviewView({ overview, totals, selectedId, onSelect, onRevoke, busy, onOpenLab }: {
  overview: Overview;
  totals: { active: number; blocked: number; settled: number; spent: bigint };
  selectedId: string;
  onSelect: (id: string) => void;
  onRevoke: (allowance: AllowanceRecord) => void;
  busy?: string;
  onOpenLab: () => void;
}) {
  const decimals = overview.assetDecimals;
  return <div className="console-content">
    <section className="treasury-identity">
      <div className="identity-main"><span className="identity-icon"><WalletCards /></span><div><small>SMART-ACCOUNT TREASURY</small><CopyAddress value={overview.treasury} /></div></div>
      <div><small>PAYMENT ASSET</small><strong>{overview.assetCode}</strong><CopyAddress value={overview.asset} /></div>
      <div><small>CURRENT LEDGER</small><strong>#{overview.currentLedger.toLocaleString()}</strong><span>updated {new Date(overview.refreshedAt).toLocaleTimeString()}</span></div>
    </section>

    <section className="metric-grid" aria-label="Treasury metrics">
      <article><div><span>TREASURY BALANCE</span><CircleDollarSign /></div><strong>{overview.balanceDisplay}</strong><small>{overview.assetCode} · {overview.balanceAtomic} atomic</small></article>
      <article><div><span>ACTIVE RULES</span><ShieldCheck /></div><strong>{totals.active}</strong><small>{overview.allowances.length} total allowances</small></article>
      <article><div><span>SETTLED</span><Zap /></div><strong>{totals.settled}</strong><small>{amount(totals.spent.toString(), decimals)} {overview.assetCode} tracked</small></article>
      <article className="metric-protected"><div><span>POLICY BLOCKS</span><ShieldX /></div><strong>{totals.blocked}</strong><small>zero funds moved</small></article>
    </section>

    <section className="allowance-section">
      <div className="console-section-heading"><div><span>DELEGATED AUTHORITY</span><h2>Active allowances</h2></div><div><button className="text-action" onClick={onOpenLab}>Open payment lab <ArrowRight /></button><span className="section-count">{overview.allowances.length} RULES</span></div></div>
      <div className="allowance-list">
        {overview.allowances.length === 0 ? <div className="empty-state"><Bot /><strong>No allowances yet</strong><span>Create a bounded rule to give an agent spending authority.</span></div> : overview.allowances.map((item) => {
          const max = BigInt(item.maxSpendAtomic);
          const spent = BigInt(item.spentAtomic);
          const percent = max === 0n ? 0 : Math.min(100, Number((spent * 100n) / max));
          return <article key={item.allowanceId} className={`allowance-row ${selectedId === item.allowanceId ? "selected" : ""}`} onClick={() => onSelect(item.allowanceId)}>
            <div className="allowance-agent"><span><Bot /></span><div><strong>{item.label}</strong><small>Context rule #{item.contextRuleId}</small></div></div>
            <div className="allowance-budget"><div><span>SPEND</span><strong>{amount(item.spentAtomic, decimals)} / {amount(item.maxSpendAtomic, decimals)} {overview.assetCode}</strong></div><div className="budget-track"><i style={{ width: `${percent}%` }} /></div></div>
            <div className="allowance-scope"><span>RECIPIENT</span><CopyAddress value={item.allowedRecipients[0] ?? ""} /></div>
            <div className="allowance-expiry"><span>EXPIRES</span><strong>Ledger {item.validUntilLedger.toLocaleString()}</strong></div>
            <Status value={item.status} />
            <button className="revoke-button" title="Revoke allowance" aria-label="Revoke allowance" disabled={item.status === "REVOKED" || busy === `revoke-${item.allowanceId}`} onClick={(event) => { event.stopPropagation(); onRevoke(item); }}><Ban /></button>
          </article>;
        })}
      </div>
    </section>

    <AttemptFeed attempts={overview.attempts.slice(0, 5)} assetCode={overview.assetCode} assetDecimals={overview.assetDecimals} />
  </div>;
}

function PaymentLab({ overview, selectedId, onSelect, busy, result, onRun }: {
  overview: Overview;
  selectedId: string;
  onSelect: (id: string) => void;
  busy?: string;
  result?: string;
  onRun: (scenario: Scenario) => Promise<void>;
}) {
  const running = Boolean(busy);
  const resultSuccess = result?.includes("PAID");
  return <div className="console-content lab-content">
    <section className="lab-header">
      <div><span>BOUNDED EXECUTION</span><h2>Run a real x402 payment path.</h2><p>Each scenario builds a fresh delegated authorization and reaches the policy boundary.</p></div>
      <label><span>ALLOWANCE</span><select value={selectedId} onChange={(event) => onSelect(event.target.value)}>{overview.allowances.map((item) => <option key={item.allowanceId} value={item.allowanceId}>Rule #{item.allowanceId} · {item.label}</option>)}</select></label>
    </section>

    <div className="lab-grid">
      <section className="scenario-controls">
        <ScenarioButton tone="success" icon={<Zap />} title="Approved payment" detail="Exact recipient · below remaining cap" action="SETTLE" busy={busy === "success"} disabled={running} onClick={() => void onRun("success")} />
        <ScenarioButton tone="warning" icon={<Gauge />} title="Over-limit payment" detail="Amount exceeds rolling allowance" action="CHALLENGE" busy={busy === "over-limit"} disabled={running} onClick={() => void onRun("over-limit")} />
        <ScenarioButton tone="danger" icon={<Fingerprint />} title="Unapproved recipient" detail="payTo differs from on-chain policy" action="CHALLENGE" busy={busy === "unapproved-recipient"} disabled={running} onClick={() => void onRun("unapproved-recipient")} />
      </section>

      <section className={`execution-stage ${running ? "running" : ""} ${result ? resultSuccess ? "success" : "danger" : ""}`}>
        <div className="stage-grid" aria-hidden="true" />
        {!result && !running && <div className="stage-idle"><span><TestTube2 /></span><strong>Execution environment ready</strong><p>Select a scenario to generate fresh, inspectable Testnet evidence.</p><div><i />FACILITATOR ONLINE</div></div>}
        {running && <div className="stage-running"><span className="execution-ring"><img src="/agentallowance-logo.jpg" alt="" /></span><strong>Authorizing payment</strong><div className="execution-steps"><span className="done"><Check />Challenge</span><span className="active"><LoaderCircle className="spin" />Policy simulation</span><span>Settlement</span></div></div>}
        {result && !running && <div className="stage-result"><span className="result-icon">{resultSuccess ? <Check /> : <ShieldX />}</span><small>{resultSuccess ? "SETTLEMENT COMPLETE" : "POLICY ENFORCED"}</small><strong>{result}</strong><p>{resultSuccess ? "Protected resource unlocked. Receipt matched to the original challenge." : "Authorization stopped before transfer. Treasury balance remains protected."}</p><button onClick={() => void onRun(resultSuccess ? "success" : result.includes("RECIPIENT") ? "unapproved-recipient" : "over-limit")}><RefreshCw />Run again</button></div>}
      </section>
    </div>

    <AttemptFeed attempts={overview.attempts.slice(0, 8)} assetCode={overview.assetCode} assetDecimals={overview.assetDecimals} live />
  </div>;
}

function ScenarioButton({ tone, icon, title, detail, action, busy, disabled, onClick }: {
  tone: string; icon: ReactNode; title: string; detail: string; action: string; busy: boolean; disabled: boolean; onClick: () => void;
}) {
  return <button className={`scenario-button ${tone}`} disabled={disabled} onClick={onClick}>
    <span className="scenario-button-icon">{busy ? <LoaderCircle className="spin" /> : icon}</span>
    <span><strong>{title}</strong><small>{detail}</small></span>
    <em>{busy ? "RUNNING" : action}</em><ChevronRight />
  </button>;
}

function EvidenceView({ overview }: { overview: Overview }) {
  return <div className="console-content evidence-content">
    <section className="evidence-hero">
      <div><span>VERIFIABLE BY DESIGN</span><h2>Every decision leaves a trail.</h2><p>Rules, attempts, policy outcomes and settlement receipts stay correlated to the same treasury.</p></div>
      <div className="evidence-score"><strong>199</strong><span>AUTOMATED CHECKS</span><div><i style={{ width: "100%" }} /></div></div>
    </section>
    <section className="chain-facts">
      <div><ShieldCheck /><span>FACILITATOR</span><strong>124 checks</strong><small>Exact transfer + auth structure</small></div>
      <div><Fingerprint /><span>POLICY VALIDATOR</span><strong>26 checks</strong><small>WASM identity + event binding</small></div>
      <div><WalletCards /><span>TREASURY</span><CopyAddress value={overview.treasury} /><small>On-chain source of truth</small></div>
      <div><CircleDollarSign /><span>ASSET</span><strong>{overview.assetCode}</strong><small>Official Stellar Testnet asset</small></div>
    </section>
    <AttemptFeed attempts={overview.attempts} assetCode={overview.assetCode} assetDecimals={overview.assetDecimals} live />
  </div>;
}

function AttemptFeed({ attempts, assetCode, assetDecimals, live = false }: { attempts: PaymentAttempt[]; assetCode: string; assetDecimals: number; live?: boolean }) {
  return <section className="attempt-section">
    <div className="console-section-heading"><div><span>{live ? "STREAMING FROM TESTNET" : "LATEST ACTIVITY"}</span><h2>{live ? "Evidence stream" : "Recent evidence"}</h2></div>{live && <span className="live-chip"><i />LIVE</span>}</div>
    <div className="attempt-list">{attempts.length === 0 ? <div className="empty-state"><FileCheck2 /><strong>No attempts recorded</strong><span>Payment decisions will appear here.</span></div> : attempts.map((item) => <article key={item.attemptId}>
      <span className={`attempt-icon ${item.decision.toLowerCase()}`}>{item.decision === "ALLOW" ? <Check /> : item.decision === "BLOCK" ? <ShieldX /> : <LoaderCircle />}</span>
      <div className="attempt-outcome"><small>{item.state === "UNLOCKED" ? "PAID RESOURCE" : "POLICY DECISION"}</small><strong>{item.reasonCode ?? (item.state === "UNLOCKED" ? "PAID_AND_UNLOCKED" : item.decision)}</strong></div>
      <div><small>AMOUNT</small><strong>{amount(item.amountAtomic, assetDecimals)} {assetCode}</strong></div>
      <div><small>RECIPIENT</small><code>{short(item.payTo, 8)}</code></div>
      <div><small>ATTEMPT</small><code>{short(item.attemptId, 8)}</code></div>
      <div><small>TIME</small><strong>{new Date(item.updatedAt).toLocaleTimeString()}</strong></div>
      {item.txHash ? <a href={`https://stellar.expert/explorer/testnet/tx/${item.txHash}`} target="_blank" rel="noreferrer" title="View transaction" aria-label="View transaction"><ExternalLink /></a> : <span className="no-tx">NO TX</span>}
    </article>)}</div>
  </section>;
}

function durationLabel(seconds: number): string {
  if (seconds < 3600) return `${seconds / 60} minutes`;
  if (seconds < 86400) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  return `${seconds / 86400} day${seconds === 86400 ? "" : "s"}`;
}

function TransactionProgress({ phase, mode }: { phase: WalletOperationPhase; mode: "create" | "revoke" }) {
  const activeIndex = phase === "preparing" ? 0 : phase === "signing" ? 1 : 2;
  const content = mode === "create" ? {
    title: phase === "preparing" ? "Building bounded authority" : phase === "signing" ? "Approve in Freighter" : "Committing allowance",
    detail: phase === "preparing"
      ? "Encoding the signer, recipient, budget and expiry into one authorization."
      : phase === "signing"
        ? "Review the exact policy in Freighter. Your treasury key never leaves the wallet."
        : "Signature accepted. The sponsored transaction is being submitted to Stellar Testnet.",
    steps: ["Build policy", "Wallet approval", "Stellar finality"],
  } : {
    title: phase === "preparing" ? "Loading on-chain rule" : phase === "signing" ? "Approve revocation" : "Removing authority",
    detail: phase === "preparing"
      ? "Resolving the exact allowance and preparing its admin authorization."
      : phase === "signing"
        ? "Confirm the revocation in Freighter. No other allowance will be changed."
        : "Signature accepted. Stellar is removing this agent's future spending authority.",
    steps: ["Resolve rule", "Wallet approval", "Stellar finality"],
  };
  return <div className={`transaction-progress ${mode}`} role="status" aria-live="polite">
    <div className="transaction-grid" />
    <div className="transaction-focus">
      <span className="transaction-orbit">{phase === "submitting" ? <Zap /> : <Fingerprint />}</span>
      <small><i />STELLAR TESTNET · LIVE OPERATION</small>
      <h3>{content.title}</h3>
      <p>{content.detail}</p>
    </div>
    <div className="transaction-steps">
      {content.steps.map((step, index) => <div className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""} key={step}>
        <span>{index < activeIndex ? <Check /> : index === activeIndex ? <LoaderCircle className="spin" /> : index + 1}</span>
        <strong>{step}</strong>
      </div>)}
    </div>
    <div className="transaction-assurance"><ShieldCheck />Fee sponsored · exact invocation only · no treasury key shared</div>
  </div>;
}

function CreateAllowanceDialog({ overview, onClose, onCreated, createAllowance }: {
  overview: Overview;
  onClose: () => void;
  onCreated: (record: AllowanceRecord) => Promise<void>;
  createAllowance: (form: { label: string; delegatedSigner: string; maxSpendAtomic: string; windowSeconds: number; recipient: string; expiresInSeconds: number }, onPhase: (phase: WalletOperationPhase) => void) => Promise<AllowanceRecord>;
}) {
  const [form, setForm] = useState({ label: "Research agent", delegatedSigner: overview.availableSigners[1] ?? overview.availableSigners[0] ?? "", maxSpendAtomic: "500000", windowSeconds: 3600, recipient: overview.merchant, expiresInSeconds: 3600 });
  const [phase, setPhase] = useState<"form" | WalletOperationPhase | "success">("form");
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<AllowanceRecord>();
  const busy = phase !== "form" && phase !== "success";
  const budget = /^\d+$/.test(form.maxSpendAtomic) ? amount(form.maxSpendAtomic, overview.assetDecimals) : "0";
  const submit = async () => {
    setError(undefined);
    try {
      const record = await createAllowance(form, setPhase);
      setCreated(record);
      setPhase("success");
      await onCreated(record);
    } catch (reason) {
      setPhase("form");
      setError(reason instanceof Error ? reason.message : "Create failed");
    }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="dialog allowance-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
      <div className="dialog-header"><div><span>ON-CHAIN ADMIN ACTION</span><h2 id="create-title">New agent allowance</h2><p>Define the boundary once. Let the agent operate inside it.</p></div><button className="dialog-close" title="Close" aria-label="Close" disabled={busy} onClick={onClose}><X /></button></div>
      {phase === "form" && <>
        <div className="dialog-stepper" aria-label="Allowance creation steps"><span className="active"><i>1</i>Configure</span><b /><span><i>2</i>Authorize</span><b /><span><i>3</i>Live</span></div>
        <div className="form-grid allowance-form">
          <label className="field full"><span>AGENT LABEL</span><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="field full"><span>DELEGATED SIGNER</span><select value={form.delegatedSigner} onChange={(e) => setForm({ ...form, delegatedSigner: e.target.value })}>{overview.availableSigners.map((value) => <option key={value} value={value}>{value}</option>)}</select><small>Signer secrets never enter the browser.</small></label>
          <label className="field"><span>BUDGET · ATOMIC UNITS</span><input inputMode="numeric" value={form.maxSpendAtomic} onChange={(e) => setForm({ ...form, maxSpendAtomic: e.target.value })} /><small>{budget} {overview.assetCode}</small></label>
          <label className="field"><span>ROLLING WINDOW</span><select value={form.windowSeconds} onChange={(e) => setForm({ ...form, windowSeconds: Number(e.target.value) })}><option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option></select></label>
          <label className="field full"><span>APPROVED RECIPIENT</span><input value={form.recipient} onChange={(e) => setForm({ ...form, recipient: e.target.value })} /></label>
          <label className="field full"><span>PERMISSION LIFETIME</span><select value={form.expiresInSeconds} onChange={(e) => setForm({ ...form, expiresInSeconds: Number(e.target.value) })}><option value={900}>15 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option></select></label>
        </div>
        <div className="allowance-review">
          <div className="allowance-review-head"><span><ShieldCheck />POLICY PREVIEW</span><small>ENFORCED ON CHAIN</small></div>
          <div className="allowance-review-grid"><div><span>AGENT</span><strong>{form.label || "Unnamed agent"}</strong></div><div><span>ROLLING CAP</span><strong>{budget} {overview.assetCode}</strong></div><div><span>WINDOW</span><strong>{durationLabel(form.windowSeconds)}</strong></div><div><span>EXPIRES</span><strong>{durationLabel(form.expiresInSeconds)}</strong></div></div>
          <div className="allowance-review-recipient"><Fingerprint /><span><small>ONLY RECIPIENT</small><code>{short(form.recipient, 12)}</code></span><Check /></div>
        </div>
        {error && <div className="dialog-error"><AlertTriangle />{error}</div>}
        <div className="dialog-actions"><button className="cancel-button" onClick={onClose}>Cancel</button><button className="confirm-button authorize-button" disabled={!form.delegatedSigner || !/^\d+$/.test(form.maxSpendAtomic)} onClick={() => void submit()}><Fingerprint />Authorize with Freighter <ArrowRight /></button></div>
      </>}
      {(phase === "preparing" || phase === "signing" || phase === "submitting") && <TransactionProgress phase={phase} mode="create" />}
      {phase === "success" && created && <div className="operation-success" role="status">
        <div className="success-emblem"><Check /><i /><i /><i /><i /></div>
        <span>ALLOWANCE #{created.contextRuleId} · ACTIVE</span>
        <h3>{created.label} is live.</h3>
        <p>The agent can now spend within the exact policy you signed. Everything outside it will fail before funds move.</p>
        <div className="success-facts"><div><small>CAP</small><strong>{amount(created.maxSpendAtomic, overview.assetDecimals)} {overview.assetCode}</strong></div><div><small>RECIPIENT</small><code>{short(created.allowedRecipients[0] ?? "", 9)}</code></div><div><small>STATUS</small><strong><i />ACTIVE</strong></div></div>
        {created.createTxHash && <a className="transaction-link" href={`https://stellar.expert/explorer/testnet/tx/${created.createTxHash}`} target="_blank" rel="noreferrer"><span><small>STELLAR TRANSACTION</small><code>{short(created.createTxHash, 12)}</code></span><ExternalLink /></a>}
        <button className="success-primary" onClick={onClose}>View live allowance <ArrowRight /></button>
      </div>}
    </div>
  </div>;
}

function RevokeDialog({ allowance, onClose, onRevoked, revokeAllowance }: {
  allowance: AllowanceRecord;
  onClose: () => void;
  onRevoked: () => Promise<void>;
  revokeAllowance: (allowance: AllowanceRecord, onPhase: (phase: WalletOperationPhase) => void) => Promise<AllowanceRecord>;
}) {
  const [phase, setPhase] = useState<"confirm" | WalletOperationPhase | "success">("confirm");
  const [revoked, setRevoked] = useState<AllowanceRecord>();
  const [error, setError] = useState<string>();
  const busy = phase !== "confirm" && phase !== "success";
  const submit = async () => {
    setError(undefined);
    try {
      const record = await revokeAllowance(allowance, setPhase);
      setRevoked(record);
      setPhase("success");
      await onRevoked();
    } catch (reason) {
      setPhase("confirm");
      setError(reason instanceof Error ? reason.message : "Revoke failed");
    }
  };
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="dialog revoke-dialog" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title">
      {phase === "confirm" && <><span className="revoke-symbol"><ShieldX /></span><span>EMERGENCY CONTROL</span><h2 id="revoke-title">Revoke rule #{allowance.contextRuleId}?</h2><p><strong>{allowance.label}</strong> will immediately lose future spending authority. Other agents remain active.</p>
        <div className="revoke-signer"><span>DELEGATED SIGNER</span><code>{allowance.delegatedSigner}</code></div>
        {error && <div className="dialog-error"><AlertTriangle />{error}</div>}
        <div className="dialog-actions"><button className="cancel-button" onClick={onClose}>Keep active</button><button className="danger-confirm" onClick={() => void submit()}><Ban />Authorize revocation</button></div></>}
      {(phase === "preparing" || phase === "signing" || phase === "submitting") && <TransactionProgress phase={phase} mode="revoke" />}
      {phase === "success" && revoked && <div className="operation-success revoke-success" role="status"><div className="success-emblem"><ShieldX /><i /><i /><i /><i /></div><span>RULE #{revoked.contextRuleId} · REVOKED</span><h3>Authority removed.</h3><p>{revoked.label} can no longer authorize future payments from this treasury.</p>{revoked.revokeTxHash && <a className="transaction-link" href={`https://stellar.expert/explorer/testnet/tx/${revoked.revokeTxHash}`} target="_blank" rel="noreferrer"><span><small>STELLAR TRANSACTION</small><code>{short(revoked.revokeTxHash, 12)}</code></span><ExternalLink /></a>}<button className="success-primary" onClick={onClose}>Done <Check /></button></div>}
    </div>
  </div>;
}
