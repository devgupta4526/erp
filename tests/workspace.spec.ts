import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = "Local test password 72!";

async function register(page: Page, label: string) {
  const suffix = randomUUID().slice(0, 12);
  const email = `${label}-${suffix}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill(`Owner ${label}`);
  await page.getByLabel("Organization").fill(`Workspace ${label} ${suffix}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create a workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  return email;
}

test("sign-in, sign-out and contacts stay within an organization", async ({ page, browser, baseURL }) => {
  const email = await register(page, "first");
  await page.goto("/workspace/contacts");
  const name = `Private contact ${randomUUID()}`;
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("table", { name: "Contact directory" }).getByText(name)).toBeVisible();

  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await register(otherPage, "second");
    await otherPage.goto("/workspace/contacts");
    await expect(otherPage.getByText("No contacts yet.")).toBeVisible();
    await expect(otherPage.getByText(name)).toHaveCount(0);
  } finally {
    await other.close();
  }

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/workspace/contacts");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
});

test("an invite grants member access and the Starter branch limit is enforced", async ({ page, browser, baseURL }) => {
  await register(page, "owner");
  const invited = await browser.newContext({ baseURL });
  try {
    const otherPage = await invited.newPage();
    const email = await register(otherPage, "invitee");
    await page.goto("/workspace/settings");
    await page.getByLabel("Branch name").fill("Main");
    await page.getByRole("button", { name: "Create branch" }).click();
    await expect(page.getByText("Branch created.")).toBeVisible();
    await page.getByLabel("Branch name").fill("Second");
    await page.getByRole("button", { name: "Create branch" }).click();
    await expect(page.getByText("This workspace has reached its plan limit.")).toBeVisible();
    await page.getByLabel("Invitee email").fill(email);
    await page.getByRole("button", { name: "Generate invitation" }).click();
    await expect(page.getByText(/Share this one-time code/)).toBeVisible();
    const offeredCode = await page.locator('input[readonly]').inputValue();
    await otherPage.goto("/workspace/settings");
    await otherPage.getByLabel("Invitation code").fill(offeredCode);
    await otherPage.getByRole("button", { name: "Join workspace" }).click();
    await expect(otherPage.getByText("Workspace joined. Select it in Switch workspace.")).toBeVisible();
    const workspace = otherPage.getByRole("combobox", { name: "Workspace", exact: true });
    const memberWorkspace = workspace.getByRole("option", { name: /\(member\)$/ });
    await workspace.selectOption({ label: await memberWorkspace.innerText() });
    await otherPage.getByRole("button", { name: "Switch workspace" }).click();
    await expect(otherPage).toHaveURL(/\/workspace$/);
    await otherPage.goto("/workspace/contacts");
    await expect(otherPage.getByRole("button", { name: "Add contact" })).toHaveCount(0);
  } finally {
    await invited.close();
  }
});

test("a paid gym membership enables one attendance record per day", async ({ page }) => {
  await register(page, "gym");
  await page.goto("/workspace/gym");
  await page.getByLabel("Name", { exact: true }).fill("Monthly membership");
  await page.getByLabel("Term in days").fill("30");
  await page.getByLabel("Price").fill("1250.50");
  await page.getByLabel("Currency").selectOption("INR");
  await page.getByRole("button", { name: "Add plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Membership plan added.");

  await page.getByLabel("Full name").fill("Gym Test Member");
  await page.getByRole("button", { name: "Register member" }).click();
  const member = page.getByRole("row", { name: /Gym Test Member/ });
  await expect(member.getByRole("cell", { name: "Inactive", exact: true })).toBeVisible();
  await expect(member.getByRole("button", { name: "Record attendance" })).toHaveCount(0);

  await member.getByText("Activate membership", { exact: true }).click();
  await member.getByLabel("Receipt reference").fill("GYM-TEST-001");
  await member.getByRole("button", { name: "Record received payment" }).click();
  await expect(page.getByRole("status")).toHaveText("Payment and membership saved.");
  const payments = page.getByRole("table", { name: "Recent membership payments" });
  await expect(payments.getByRole("row", { name: /GYM-TEST-001/ })).toContainText("₹1,250.50");
  const roster = page.getByRole("table", { name: "Gym member roster" });
  const attendance = roster.getByRole("button", { name: "Record attendance" });
  await expect(roster.getByRole("cell", { name: "Active", exact: true })).toBeVisible();
  await attendance.click();
  await expect(page.getByRole("status")).toHaveText("Attendance recorded for today.");
  await expect(roster.getByRole("cell", { name: "Recorded", exact: true })).toBeVisible();
  await expect(attendance).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Daily attendance" }).getByRole("cell", { name: "1", exact: true })).toBeVisible();
});

test("an invoice can be drafted, issued and paid in installments", async ({ page }) => {
  await register(page, "invoices");
  await page.goto("/workspace/invoices");
  await page.getByLabel("Customer name").fill("Test customer");
  await page.getByLabel("Currency").selectOption("INR");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByLabel("Description").fill("Workshop");
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Unit price").fill("25.50");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(page.getByRole("rowheader", { name: "Workshop" })).toBeVisible();
  await page.getByRole("button", { name: "Issue and lock invoice" }).click();
  await expect(page.getByRole("heading", { name: "Invoice 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);
  await page.getByLabel("Payment reference").fill("PAY-01");
  await page.getByLabel("Amount received").fill("20");
  await page.getByRole("button", { name: "Record payment received" }).click();
  await expect(page.getByText(/PAY-01/)).toBeVisible();
  await page.getByLabel("Payment reference").fill("PAY-02");
  await page.getByLabel("Amount received").fill("31");
  await page.getByRole("button", { name: "Record payment received" }).click();
  await expect(page.getByText(/PAY-02/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment received" })).toHaveCount(0);
});

test("the schedule rejects overlapping appointments for the same staff member", async ({ page }) => {
  await register(page, "appointments");
  await page.goto("/workspace/schedule");
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const book = async (subject: string, start: string, end: string) => {
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Starts at (UTC)").fill(`${day}T${start}`);
    await page.getByLabel("Ends at (UTC)").fill(`${day}T${end}`);
    await page.getByRole("button", { name: "Book appointment" }).click();
  };
  await book("First booking", "09:00", "10:00");
  await expect(page.getByRole("rowheader", { name: "First booking" })).toBeVisible();
  await book("Conflicting booking", "09:30", "10:30");
  await expect(page.getByText("This staff member already has an appointment during that time.")).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Conflicting booking" })).toHaveCount(0);
});

test("rental bookings reject an overlap and allow a same-day handoff", async ({ page }) => {
  await register(page, "rental");
  await page.goto("/workspace/car-rental");
  await page.getByLabel("Registration", { exact: true }).fill("DEMO-001");
  await page.getByLabel("Vehicle name").fill("Test vehicle");
  await page.getByLabel("Daily rate").fill("120.00");
  await page.getByRole("button", { name: "Add vehicle" }).click();
  await expect(page.getByText("Test vehicle", { exact: true })).toBeVisible();

  const date = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const book = async (name: string, from: number, until: number) => {
    await page.getByLabel("Vehicle registration").fill("DEMO-001");
    await page.getByLabel("Renter name").fill(name);
    await page.getByLabel("Pickup date").fill(date(from));
    await page.getByLabel("Return date").fill(date(until));
    await page.getByRole("button", { name: "Book vehicle" }).click();
  };
  await book("First renter", 1, 4);
  await expect(page.getByText("First renter", { exact: true })).toBeVisible();
  await book("Conflicting renter", 2, 3);
  await expect(page.getByText("This vehicle already has a booking for those dates.")).toBeVisible();
  await book("Next renter", 4, 6);
  await expect(page.getByText("Next renter", { exact: true })).toBeVisible();
});

test("practice attachments are private and the assigned owner cannot self-approve", async ({ page, browser, baseURL }) => {
  await register(page, "practice");
  await page.goto("/workspace/crm");
  await page.getByLabel("Company name").fill("Test accounting client");
  await page.getByRole("button", { name: "Add company" }).click();
  await expect(page.getByRole("link", { name: "Test accounting client" })).toBeVisible();
  await page.goto("/workspace/accounting-practice");
  await page.getByLabel("Title", { exact: true }).fill("Test engagement");
  await page.getByLabel("Deadline").fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create engagement" }).click();
  await expect(page.getByRole("heading", { name: "Test engagement" })).toBeVisible();
  await page.getByLabel(/PDF or text file/).setInputFiles({
    name: "workpaper.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Private verification fixture"),
  });
  await page.getByRole("button", { name: "Add document" }).click();
  const link = page.getByRole("link", { name: "workpaper.txt" });
  await expect(link).toBeVisible();
  const documentUrl = await link.getAttribute("href");
  if (!documentUrl) throw new Error("Missing private attachment URL");
  const download = await page.request.get(documentUrl);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(await download.text()).toBe("Private verification fixture");

  const other = await browser.newContext({ baseURL });
  try {
    await register(await other.newPage(), "unrelated");
    expect((await other.request.get(documentUrl)).status()).toBe(404);
  } finally {
    await other.close();
  }

  await page.getByRole("button", { name: "Submit for review" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("An owner or admin other than the assigned staff member must approve this engagement.")).toBeVisible();
});
