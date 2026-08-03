import { expect, test, type Page } from "@playwright/test";

const signer = "GAO2CS7KBZS6DF4FOM4WJA3N2FUV4HSCVQI3BFJ4G233W7XJ7EBCAUKX";
const merchant = "GDYGNUG2DKQVRJYYMXO5AUFEMMEMW7NIOGCQZSVYVNVMS4GNROZYJ5SZ";

async function mockOverview(page: Page): Promise<void> {
  await page.route("**/api/overview", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      network: "stellar:testnet",
      treasury: "CDHMMKMC7L54AY5WWUDTFMTQFKEI5GO3U7NQCOUC4SFYICSQ5EQTBQCX",
      asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      balanceAtomic: "4700000",
      balanceDisplay: "0.47",
      currentLedger: 3948647,
      merchant,
      facilitatorUrl: "http://127.0.0.1:8080/api/v1/plugins/x402-facilitator/call",
      availableSigners: [signer],
      allowances: [{
        allowanceId: "2",
        label: "Data agent",
        network: "stellar:testnet",
        treasuryContract: "CDHMMKMC7L54AY5WWUDTFMTQFKEI5GO3U7NQCOUC4SFYICSQ5EQTBQCX",
        assetContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
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
        assetContract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
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
    containers: [...document.querySelectorAll<HTMLElement>(".section-block, .table-wrap")].map((element) => ({
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

test("renders overview and command center without viewport overflow", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Treasury overview" })).toBeVisible();
  await expect(page.getByText("0.47 XLM")).toBeVisible();
  await expect(page.getByText("Data agent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();
  await expectNoViewportOverflow(page);

  await page.getByRole("button", { name: "Command Center" }).click();
  await expect(page.getByRole("heading", { name: "Live command center" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approved payment/ })).toBeVisible();
  await expectNoViewportOverflow(page);
  expect(errors).toEqual([]);
});

test("keeps legacy operator route on the wallet-owner screen", async ({ page }) => {
  await page.goto("/operator");
  await expect(page.getByRole("button", { name: "Connect Freighter" })).toBeVisible();
  await expectNoViewportOverflow(page);
});
