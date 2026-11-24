import { test, expect } from '@playwright/test';

test.describe('CommissionOS Web Application E2E Tests', () => {
  test('Login flow and sidebar profile verification', async ({ page }) => {
    // 1. Visit the app
    await page.goto('/');

    // 2. Expect Login Page to be visible
    await expect(page.locator('input[placeholder="Email address"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Password"]')).toBeVisible();

    // 3. Fill credentials
    await page.locator('input[placeholder="Full name"]').fill('Poojitha');
    await page.locator('input[placeholder="Email address"]').fill('poojitha@alphaauron.com');
    await page.locator('input[placeholder="Password"]').fill('Admin@123');

    // 4. Click Sign In
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 5. Verify successful login to dashboard
    await expect(page.locator('text=Executive Commission Command Center')).toBeVisible({ timeout: 15000 });

    // 6. Verify profile badge in sidebar with 2 starting letters of email ('PO')
    const profileBadge = page.locator('div[title="poojitha@alphaauron.com"]');
    await expect(profileBadge).toBeVisible();
    await expect(profileBadge).toHaveText('PO');
  });
});
