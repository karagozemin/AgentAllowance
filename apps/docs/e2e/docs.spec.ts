import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

test("opens the developer portal and navigates to the quickstart", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bounded payments for autonomous agents." })).toBeVisible();
  await expect(page.getByText("npm install @agentallowance/sdk @stellar/stellar-sdk")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: /Start building/ }).click();
  await expect(page.getByRole("heading", { name: "5-minute quickstart" })).toBeVisible();
  await expect(page.getByText("DELEGATED_SIGNER_SECRET", { exact: false }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("finds typed settlement guidance with full-text search", async ({ page, isMobile }) => {
  test.skip(isMobile, "Search keyboard interaction is covered on desktop; mobile uses the same index.");
  await page.goto("/");
  await page.getByRole("button", { name: /Search/ }).click();
  const search = page.getByRole("searchbox");
  await search.fill("SETTLEMENT_UNKNOWN");
  await expect(page.getByText("Reconcile settlement", { exact: false }).first()).toBeVisible();
});
