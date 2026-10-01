import { expect, test, type Page } from "@playwright/test";

const signer = "GAO2CS7KBZS6DF4FOM4WJA3N2FUV4HSCVQI3BFJ4G233W7XJ7EBCAUKX";
const merchant = "GDYGNUG2DKQVRJYYMXO5AUFEMMEMW7NIOGCQZSVYVNVMS4GNROZYJ5SZ";
const owner = "GBRAUS55PHX2NL5RRIMULZT2WIEBIYR2LLHIVZOHDPBWOWUJIE6S3UGA";

async function mockOverview(page: Page): Promise<void> {
  await page.route("**/api/owner/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: false }),
  }));
  await page.route("**/api/overview", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      network: "stellar:testnet",
      treasury: "CDHMMKMC7L54AY5WWUDTFMTQFKEI5GO3U7NQCOUC4SFYICSQ5EQTBQCX",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      assetCode: "USDC",
      assetDecimals: 7,
      balanceAtomic: "5000000",
      balanceDisplay: "0.5",
      currentLedger: 3948647,
      merchant,
      facilitatorUrl: "http://127.0.0.1:8080/api/v1/plugins/x402-facilitator/call",
      availableSigners: [signer],
      allowances: [{
        allowanceId: "2",
        label: "Data agent",
        network: "stellar:testnet",
        treasuryContract: "CDHMMKMC7L54AY5WWUDTFMTQFKEI5GO3U7NQCOUC4SFYICSQ5EQTBQCX",
        assetContract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        delegatedSigner: signer,
        maxSpendAtomic: "500000",
        spentAtomic: "100000",
        windowLedgers: 720,
        allowedRecipients: [merchant],
        validUntilLedger: 3957804,
        contextRuleId: 2,
        createTxHash: "4b3eae8ed6aff0cf988cfc34257e59512eced48486c261f19be9e90a93946370",
        status: "ACTIVE",
        createdAt: "2026-08-03T02:00:15.530Z",
        updatedAt: "2026-08-03T13:18:26.514Z",
      }],
      attempts: [{
        attemptId: "d912c100-ed24-4fb4-8add-d1880c4fe5da",
        allowanceId: "2",
        url: "http://127.0.0.1:3001/premium",
        requestReference: "challenge-1",
        challengeHash: "aa",
        amountAtomic: "100000",
        payTo: merchant,
        assetContract: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
        state: "UNLOCKED",
        decision: "ALLOW",
        txHash: "db9547660e7adb57f371fcbacacb635c0714e4f205024cdf1192bb00034afa1c",
        createdAt: "2026-08-03T13:18:20.000Z",
        updatedAt: "2026-08-03T13:18:26.514Z",
      }],
      refreshedAt: "2026-08-03T13:18:30.000Z",
    }),
  }));
}

async function expectNoViewportOverflow(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    window.scrollTo(10_000, 0);
    const measured = {
    pageScrollX: window.scrollX,
    bodyRight: Math.round(document.body.getBoundingClientRect().right),
    viewportWidth: window.innerWidth,
    containers: [...document.querySelectorAll<HTMLElement>(".landing-hero, .console-content, .allowance-section, .attempt-section")].map((element) => ({
      className: element.className,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
      left: Math.round(element.getBoundingClientRect().left),
      right: Math.round(element.getBoundingClientRect().right),
    })),
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter((item) => item.left < -1 || item.right > window.innerWidth + 1)
      .slice(0, 12),
    };
    window.scrollTo(0, 0);
    return measured;
  });
  expect(result, JSON.stringify(result, null, 2)).toMatchObject({
    pageScrollX: 0,
    bodyRight: result.viewportWidth,
  });
}

async function mockWalletOwner(page: Page): Promise<void> {
  let authenticated = false;
  await page.addInitScript(({ walletAddress }) => {
    window.addEventListener("message", (event) => {
      const request = event.data as { source?: string; messageId?: number; type?: string };
      if (request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST" || !request.messageId) return;
      const response: Record<string, unknown> = {
        source: "FREIGHTER_EXTERNAL_MSG_RESPONSE",
        messagedId: request.messageId,
      };
      if (request.type === "REQUEST_ACCESS") response.publicKey = walletAddress;
      if (request.type === "REQUEST_ALLOWED_STATUS") response.isAllowed = true;
      if (request.type === "REQUEST_NETWORK_DETAILS") response.networkDetails = {
        network: "TESTNET",
        networkUrl: "https://horizon-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        sorobanRpcUrl: "https://soroban-testnet.stellar.org",
      };
      if (request.type === "SUBMIT_BLOB") {
        response.signedBlob = "wallet-session-signature";
        response.signerAddress = walletAddress;
      }
      if (request.type === "SUBMIT_AUTH_ENTRY") {
        response.signedAuthEntry = "wallet-auth-entry";
        response.signerAddress = walletAddress;
      }
      window.setTimeout(() => window.postMessage(response, window.location.origin), request.type === "SUBMIT_AUTH_ENTRY" ? 350 : 0);
    });
  }, { walletAddress: owner });

  const ownerOverview = {
    network: "stellar:testnet",
    treasury: "CBCXCPFP6EBWEYYQS7DWXFYQ3ZP24MNUFAIMFBI5ADTCXEWJTSBD27BU",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    assetCode: "USDC",
    assetDecimals: 7,
    balanceAtomic: "1000000",
    balanceDisplay: "0.1",
    currentLedger: 3967000,
    merchant,
    facilitatorUrl: "https://agentallowance-facilitator.onrender.com",
    availableSigners: [signer],
    allowances: [],
    attempts: [],
    refreshedAt: "2026-08-04T12:00:00.000Z",
  };
  const created = {
    allowanceId: "3",
    label: "Research agent",
    network: "stellar:testnet",
    treasuryContract: ownerOverview.treasury,
    assetContract: ownerOverview.asset,
    delegatedSigner: signer,
    maxSpendAtomic: "500000",
    spentAtomic: "0",
    windowLedgers: 720,
    allowedRecipients: [merchant],
    validUntilLedger: 3984280,
    contextRuleId: 3,
    createTxHash: "6f07e5383589056c30b0c15fde90da28efb9f25f22a1f0c2aeb5040252fda032",
    status: "ACTIVE",
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:00.000Z",
  };
  await page.route("**/api/owner/challenge?*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ message: "Sign in", nonce: "nonce" }) }));
  await page.route("**/api/owner/login", (route) => {
    authenticated = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, address: owner }) });
  });
  await page.route("**/api/owner/profile", (route) => authenticated
    ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ address: owner, treasury: ownerOverview.treasury, onboarded: true }) })
    : route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "OWNER_SESSION_REQUIRED" }) }));
  await page.route("**/api/owner/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(authenticated
      ? { authenticated: true, profile: { address: owner, treasury: ownerOverview.treasury, onboarded: true } }
      : { authenticated: false }),
  }));
  await page.route("**/api/owner/overview", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(ownerOverview) }));
  await page.route("**/api/owner/allowances/prepare", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ operationId: "create-3", authPreimageXdr: "auth-preimage" }) }));
  await page.route("**/api/owner/allowances/submit", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(created) });
  });
}

test.beforeEach(async ({ page }) => {
  await mockOverview(page);
});

test("moves from the product landing into the live control plane", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AgentAllowance" })).toBeVisible();
  await expect(page.getByText("Autonomy without unlimited authority.")).toBeVisible();
  await expect(page.getByText("Paid. Blocked. Verifiable.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "https://agentallowance-docs.onrender.com/");
  await expectNoViewportOverflow(page);

  await page.getByRole("button", { name: /Enter the dApp/ }).click();
  await expect(page.getByRole("heading", { name: "Treasury overview" })).toBeVisible();
  await expect(page.getByText("0.5", { exact: true })).toBeVisible();
  await expect(page.getByText("Data agent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();
  await expectNoViewportOverflow(page);

  if (await page.getByRole("button", { name: "Open navigation" }).isVisible()) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page.getByRole("button", { name: "Payment lab", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payment lab" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approved payment/ })).toBeVisible();
  await expectNoViewportOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps legacy operator route on the wallet-owner screen", async ({ page }) => {
  await page.goto("/operator");
  await expect(page.getByRole("heading", { name: "Treasury overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("shows the full Freighter allowance transaction lifecycle", async ({ page }) => {
  await mockWalletOwner(page);
  await page.goto("/app");
  await page.getByRole("button", { name: "Connect Freighter" }).click();
  await expect(page.getByRole("button", { name: "New allowance" })).toBeVisible();
  await page.getByRole("button", { name: "New allowance" }).click();
  await expect(page.getByRole("heading", { name: "New agent allowance" })).toBeVisible();
  await expect(page.getByText("POLICY PREVIEW")).toBeVisible();
  await expect(page.locator(".allowance-review-grid").getByText("0.05 USDC")).toBeVisible();

  await page.getByRole("button", { name: /Authorize with Freighter/ }).click();
  await expect(page.getByRole("heading", { name: "Approve in Freighter" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Committing allowance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Research agent is live." })).toBeVisible();
  await expect(page.getByText("ALLOWANCE #3 · ACTIVE")).toBeVisible();
  await expect(page.getByText("6f07e5383589...fda032")).toBeVisible();
  await expectNoViewportOverflow(page);
});

test("restores the connected owner after a page refresh", async ({ page }) => {
  await mockWalletOwner(page);
  await page.goto("/app");
  await page.getByRole("button", { name: "Connect Freighter" }).click();
  await expect(page.getByRole("button", { name: "New allowance" })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("button", { name: "New allowance" })).toBeVisible();
  await expect(page.locator(".mode-badge")).toHaveText("My treasury");
  await expect(page.getByRole("button", { name: "Connect Freighter" })).toHaveCount(0);
  await expectNoViewportOverflow(page);
});
