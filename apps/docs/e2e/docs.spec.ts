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

test("opens directly on the overview and navigates to the quickstart", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "AgentAllowance overview" })).toBeVisible();
  if (!isMobile) {
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByText("Edit page", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Last updated:/)).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  if (isMobile) await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "5-minute quickstart", exact: true }).click();
  await expect(page.getByRole("heading", { name: "5-minute quickstart" })).toBeVisible();
  await expect(page.getByText("DELEGATED_SIGNER_SECRET", { exact: false }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("finds typed settlement guidance with full-text search", async ({ page, isMobile }) => {
  test.skip(isMobile, "Search keyboard interaction is covered on desktop; mobile uses the same index.");
  await page.goto("/");
  await page.getByRole("button", { name: /Search/ }).click();
  const search = page.locator("#starlight__search input.pagefind-ui__search-input");
  await search.fill("SETTLEMENT_UNKNOWN");
  await expect(page.getByText("Reconcile settlement", { exact: false }).first()).toBeVisible();
});
