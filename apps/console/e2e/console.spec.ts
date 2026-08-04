import { expect, test, type Page } from "@playwright/test";

const signer = "GAO2CS7KBZS6DF4FOM4WJA3N2FUV4HSCVQI3BFJ4G233W7XJ7EBCAUKX";
const merchant = "GDYGNUG2DKQVRJYYMXO5AUFEMMEMW7NIOGCQZSVYVNVMS4GNROZYJ5SZ";

async function mockOverview(page: Page): Promise<void> {
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
