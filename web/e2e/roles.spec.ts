import { test, expect } from "@playwright/test";

/**
 * UI E2E — six role logins + landing dashboards (§10.6 / §10.5 smoke).
 * Demo accounts are DEVELOPMENT ONLY (pnpm db:seed:demo).
 */

const ROLES = [
  { email: "demo.manager@example.test", landing: /manager/ },
  { email: "demo.finance@example.test", landing: /finance/ },
  { email: "demo.sorter@example.test", landing: /sorter/ },
  { email: "demo.authority@example.test", landing: /authority/ },
  { email: "demo.collector@example.test", landing: /collector/ },
  { email: "demo.citizen@example.test", landing: /citizen/ }
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /منصة إدارة النفايات/ })).toBeVisible();
});

test("wrong password shows Arabic problem details", async ({ page }) => {
  await page.getByLabel(/البريد الإلكتروني أو رقم الهاتف/).fill("demo.manager@example.test");
  await page.getByLabel(/كلمة المرور/).fill("WRONG");
  await page.getByRole("button", { name: /تسجيل الدخول/ }).click();
  await expect(page.getByText(/غير صحيحة/)).toBeVisible();
});

for (const role of ROLES) {
  test(`login as ${role.email} lands on ${role.landing} dashboard`, async ({ page }) => {
    await page.getByLabel(/البريد الإلكتروني أو رقم الهاتف/).fill(role.email);
    await page.getByLabel(/كلمة المرور/).fill("Demo@12345!");
    await page.getByRole("button", { name: /تسجيل الدخول/ }).click();
    await expect(page).toHaveURL(role.landing);
    // shell rendered with logout control (session active)
    await expect(page.getByRole("button", { name: /تسجيل الخروج/ })).toBeVisible();
  });
}

test("unauthenticated user is redirected to /login", async ({ page }) => {
  await page.goto("/manager");
  await expect(page).toHaveURL(/login/);
});

test("citizen cannot open finance dashboard URL (guard)", async ({ page }) => {
  await page.getByLabel(/البريد الإلكتروني أو رقم الهاتف/).fill("demo.citizen@example.test");
  await page.getByLabel(/كلمة المرور/).fill("Demo@12345!");
  await page.getByRole("button", { name: /تسجيل الدخول/ }).click();
  await expect(page).toHaveURL(/citizen/);
  await page.goto("/finance/invoices");
  await expect(page).toHaveURL(/forbidden|citizen/);
});
