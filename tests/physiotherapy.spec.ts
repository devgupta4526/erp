import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function register(page: Page) {
  const id = randomUUID();
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Physiotherapy Test Owner");
  await page.getByLabel("Organization").fill(`Physiotherapy ${id}`);
  await page.getByLabel("Email address").fill(`${id}@example.test`);
  await page.getByLabel("Password").fill("Physiotherapy test password 68!");
  await page.getByRole("button", { name: "Create a workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
}

test("sample physiotherapy patient supports progress, session invoicing and tenant isolation", async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  await register(page);
  await page.getByRole("link", { name: "Physiotherapy", exact: true }).click();
  await page.getByRole("button", { name: "Load sample patient" }).click();
  await expect(page.getByRole("heading", { name: "Asha Demo" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Demo rehabilitation plan" })).toBeVisible();
  const patientUrl = page.url();
  await expect(page.getByRole("link", { name: "Open session invoice" })).toHaveCount(1);
  await page.getByLabel("Progress note").fill("Synthetic follow-up recorded.");
  await page.getByLabel("Patient-reported rating").fill("3");
  await page.getByRole("button", { name: "Complete session" }).click();
  await expect(page.getByText("Synthetic follow-up recorded.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Create session invoice" }).click();
  const invoices = page.getByRole("link", { name: "Open session invoice" });
  await expect(invoices).toHaveCount(2);
  await invoices.first().click();
  await expect(page.getByRole("rowheader", { name: "Physiotherapy session" })).toBeVisible();
  await page.getByRole("button", { name: "Issue and lock invoice" }).click();
  await page.getByLabel("Payment reference").fill("PHYSIO-DEMO-001");
  await page.getByLabel("Amount received").fill("1200");
  await page.getByRole("button", { name: "Record payment received" }).click();
  await expect(page.getByText(/PHYSIO-DEMO-001/)).toBeVisible();
  await page.goto(patientUrl);
  await expect(page.getByText(/Open session invoice · paid/)).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    const outsider = await other.newPage();
    await register(outsider);
    await outsider.goto(patientUrl);
    await expect(outsider.getByRole("heading", { name: "Asha Demo" })).toHaveCount(0);
    await expect(outsider.getByText(/This page could not be found/)).toBeVisible();
  } finally {
    await other.close();
  }
});

test("a paid package covers a checked-in home visit and consumes one credit", async ({ page }) => {
  test.setTimeout(60_000);
  await register(page);
  await page.getByRole("link", { name: "Physiotherapy", exact: true }).click();
  await page.getByRole("button", { name: "Load sample patient" }).click();
  await expect(page.getByRole("heading", { name: "Asha Demo" })).toBeVisible();
  const patient = page.url();
  await expect(page.getByText(/3 sessions · 3 remaining · Awaiting payment/)).toBeVisible();
  await page.getByRole("link", { name: "Open package invoice" }).click();
  await page.getByRole("button", { name: "Issue and lock invoice" }).click();
  await page.getByLabel("Payment reference").fill("PHYSIO-PACKAGE-001");
  await page.getByLabel("Amount received").fill("2400");
  await page.getByRole("button", { name: "Record payment received" }).click();
  await expect(page.getByText(/PHYSIO-PACKAGE-001/)).toBeVisible();
  await page.goto(patient);
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText(/· Checked in/)).toBeVisible();
  await page.getByLabel("Progress note").fill("Synthetic visit completed with a prepaid credit.");
  await page.getByLabel("Modalities used").fill("Synthetic modality entry");
  await page.getByLabel("Session billing").selectOption({ label: "Prepaid package · 3 of 3 remaining" });
  await page.getByRole("button", { name: "Complete session" }).click();
  await expect(page.getByText(/3 sessions · 2 remaining · Paid/)).toBeVisible();
  await expect(page.getByText("Covered by prepaid package")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create session invoice" })).toHaveCount(0);
});
