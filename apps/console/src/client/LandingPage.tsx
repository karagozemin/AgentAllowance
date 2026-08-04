import {
  ArrowRight,
  Bot,
  Braces,
  Check,
  CircleDollarSign,
  Code2,
  DatabaseZap,
  ExternalLink,
  Fingerprint,
  Gauge,
  LockKeyhole,
  Radio,
  ShieldCheck,
  ShieldX,
  Sparkles,
  TimerReset,
  WalletCards,
  Zap,
} from "lucide-react";

type LandingPageProps = {
  onLaunch: () => void;
  launching: boolean;
};

const proofTx = "449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d";

function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand-lockup ${compact ? "compact" : ""}`}>
    <img src="/agentallowance-logo.jpg" alt="" />
    <span>AgentAllowance</span>
  </span>;
}

function HeroNetwork() {
  return <div className="hero-network" aria-hidden="true">
    <img className="hero-mark" src="/agentallowance-logo.jpg" alt="" />
    <span className="network-line line-a" />
    <span className="network-line line-b" />
    <span className="network-line line-c" />
    <div className="network-node treasury-node">
      <WalletCards />
      <span>Parent treasury</span>
      <strong>USDC vault</strong>
    </div>
    <div className="network-node agent-node">
      <Bot />
      <span>Research agent</span>
      <strong>$0.50 / hour</strong>
    </div>
    <div className="network-node service-node">
      <DatabaseZap />
      <span>Premium API</span>
      <strong>x402 resource</strong>
    </div>
    <div className="network-packet packet-a"><Zap /></div>
    <div className="network-packet packet-b"><Check /></div>
    <div className="policy-orbit orbit-budget"><Gauge /><span>Budget</span></div>
    <div className="policy-orbit orbit-recipient"><Fingerprint /><span>Recipient</span></div>
    <div className="policy-orbit orbit-expiry"><TimerReset /><span>Expiry</span></div>
  </div>;
}

function LaunchIntro() {
  return <div className="launch-intro" role="status" aria-live="polite">
    <div className="launch-core"><img src="/agentallowance-logo.jpg" alt="" /></div>
    <p>Opening the control plane</p>
    <div className="launch-checks">
      <span><Check />Treasury</span>
      <span><Check />Policies</span>
      <span><Check />x402</span>
    </div>
    <span className="launch-progress" />
  </div>;
}

export function LandingPage({ onLaunch, launching }: LandingPageProps) {
  return <div className="landing">
    {launching && <LaunchIntro />}
    <header className="landing-nav">
      <a href="#top" aria-label="AgentAllowance home"><Brand /></a>
      <nav aria-label="Landing navigation">
        <a href="#use-cases">Use cases</a>
        <a href="#proof">Live proof</a>
        <a href="#architecture">Architecture</a>
        <a href="https://agentallowance-docs.onrender.com/" target="_blank" rel="noreferrer">Docs</a>
      </nav>
      <button className="nav-launch" onClick={onLaunch}>Launch app <ArrowRight /></button>
    </header>

    <main>
      <section className="landing-hero" id="top">
        <HeroNetwork />
        <div className="hero-copy">
          <div className="hero-kicker"><span />LIVE ON <img src="/stellar-logo.svg" alt="Stellar" /></div>
          <h1>AgentAllowance</h1>
          <p>Give autonomous agents real USDC spending power without giving them your treasury.</p>
          <div className="hero-actions">
            <button className="hero-primary" onClick={onLaunch}>Enter the dApp <ArrowRight /></button>
            <a className="hero-secondary" href="#proof">Inspect the proof <Radio /></a>
          </div>
          <div className="hero-trust">
            <span><ShieldCheck />On-chain limits</span>
            <span><LockKeyhole />No shared treasury key</span>
            <span><CircleDollarSign />Official Testnet USDC</span>
          </div>
        </div>
        <div className="hero-scroll"><span />SCROLL TO VERIFY</div>
      </section>

      <div className="ledger-ticker" aria-label="Live product facts">
        <span><i />SETTLED ON STELLAR</span>
        <span>USDC EXACT PAYMENT</span>
        <span>124 FACILITATOR CHECKS</span>
        <span>26 POLICY CHECKS</span>
        <span>0 FUNDS MOVED ON BLOCK</span>
      </div>

      <section className="problem-band">
        <div className="section-index">01 / THE PRIMITIVE</div>
        <div className="problem-statement">
          <h2>Autonomy without unlimited authority.</h2>
          <p>One treasury. Many agents. Every payment constrained by signer, recipient, budget and time before funds move.</p>
        </div>
        <div className="policy-stack">
          <div><span>01</span><ShieldCheck /><strong>Delegate</strong><p>Bind one agent signer to one narrow context rule.</p></div>
          <div><span>02</span><Braces /><strong>Enforce</strong><p>Evaluate budget, recipient and expiry inside the smart account.</p></div>
          <div><span>03</span><Zap /><strong>Settle</strong><p>Pay the x402 service and unlock the resource autonomously.</p></div>
        </div>
      </section>

      <section className="use-cases" id="use-cases">
        <div className="section-heading-landing">
          <div><span>02 / REAL WORK</span><h2>Built for agents that need to buy things.</h2></div>
          <p>Not a wallet demo. A programmable treasury layer for machine commerce.</p>
        </div>
        <div className="use-case-grid">
          <article>
            <div className="case-top"><DatabaseZap /><span>DATA</span></div>
            <h3>Research agent</h3>
            <p>Purchase premium datasets and search results from approved providers during a research run.</p>
            <div className="case-rule"><span>DAILY LIMIT</span><strong>5.00 USDC</strong></div>
            <div className="case-rule"><span>DESTINATION</span><strong>2 approved APIs</strong></div>
          </article>
          <article className="case-featured">
            <div className="case-top"><Code2 /><span>COMPUTE</span></div>
            <h3>Build agent</h3>
            <p>Pay for simulations, inference and CI minutes without exposing the parent wallet to the runtime.</p>
            <div className="case-rule"><span>RUN LIMIT</span><strong>1.25 USDC</strong></div>
            <div className="case-rule"><span>LIFETIME</span><strong>45 minutes</strong></div>
          </article>
          <article>
            <div className="case-top"><Radio /><span>OPERATIONS</span></div>
            <h3>Incident agent</h3>
            <p>Buy diagnostics during an active incident, then lose all spending authority when the window closes.</p>
            <div className="case-rule"><span>INCIDENT CAP</span><strong>10.00 USDC</strong></div>
            <div className="case-rule"><span>REVOCATION</span><strong>Immediate</strong></div>
          </article>
        </div>
      </section>

      <section className="proof-section" id="proof">
        <div className="proof-copy">
          <span className="section-index inverse">03 / PROOF, NOT PROMISES</span>
          <h2>Paid. Blocked. Verifiable.</h2>
          <p>The same smart-account treasury completed a hosted x402 payment and rejected both adversarial attempts without moving another unit of USDC.</p>
          <a href={`https://stellar.expert/explorer/testnet/tx/${proofTx}`} target="_blank" rel="noreferrer">
            View transaction on Stellar Expert <ExternalLink />
          </a>
        </div>
        <div className="proof-terminal">
          <div className="terminal-bar"><span><i /><i /><i /></span><strong>LIVE TESTNET EVIDENCE</strong><em>LEDGER 3,956,162</em></div>
          <div className="terminal-flow">
            <div className="flow-row success"><span><Check /></span><div><strong>APPROVED PAYMENT</strong><small>100000 atomic USDC</small></div><b>PAID_AND_UNLOCKED</b></div>
            <div className="flow-row danger"><span><ShieldX /></span><div><strong>OVER LIMIT</strong><small>1000001 exceeds 400000</small></div><b>BUDGET_EXCEEDED</b></div>
            <div className="flow-row warning"><span><Fingerprint /></span><div><strong>WRONG RECIPIENT</strong><small>payTo outside policy</small></div><b>RECIPIENT_NOT_ALLOWED</b></div>
          </div>
          <div className="terminal-hash"><span>TX</span><code>{proofTx}</code><Check /></div>
          <div className="terminal-delta"><div><span>TREASURY</span><strong>-0.0100000</strong></div><div><span>MERCHANT</span><strong>+0.0100000</strong></div><div><span>BLOCKED LOSS</span><strong>0.0000000</strong></div></div>
        </div>
      </section>

      <section className="architecture-section" id="architecture">
        <div className="section-heading-landing">
          <div><span>04 / THE SYSTEM</span><h2>Policy is the product.</h2></div>
          <p>The SDK predicts. The smart account decides. The facilitator verifies. Stellar settles.</p>
        </div>
        <div className="architecture-flow">
          <div><Bot /><span>01</span><strong>Agent</strong><small>Receives HTTP 402</small></div>
          <ArrowRight />
          <div><WalletCards /><span>02</span><strong>Smart account</strong><small>Enforces allowance</small></div>
          <ArrowRight />
          <div><ShieldCheck /><span>03</span><strong>Facilitator</strong><small>Verifies exact payload</small></div>
          <ArrowRight />
          <div><Zap /><span>04</span><strong>Stellar</strong><small>Settles USDC</small></div>
        </div>
        <div className="verification-row">
          <div><strong>124</strong><span>facilitator checks</span></div>
          <div><strong>26</strong><span>policy checks</span></div>
          <div><strong>212</strong><span>automated checks</span></div>
          <div><strong>2</strong><span>signed auth entries</span></div>
        </div>
      </section>

      <section className="final-cta">
        <img src="/agentallowance-logo.jpg" alt="" />
        <span><Sparkles />AGENTIC PAYMENTS, CONTROLLED</span>
        <h2>Fund the mission.<br />Bound the risk.</h2>
        <button onClick={onLaunch}>Launch AgentAllowance <ArrowRight /></button>
      </section>
    </main>

    <footer className="landing-footer">
      <Brand compact />
      <span>Built on Stellar · Testnet only · Unaudited contracts</span>
      <div><a href="https://agentallowance-docs.onrender.com/" target="_blank" rel="noreferrer">Developer docs</a><a href="https://github.com/karagozemin/AgentAllowance" target="_blank" rel="noreferrer">GitHub</a><a href="#proof">Evidence</a></div>
    </footer>
  </div>;
}
