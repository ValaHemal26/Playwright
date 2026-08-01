import { test, expect } from '@playwright/test';

// Helper for human-like delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('scrape wethrift', async ({ playwright }) => {
  test.setTimeout(180000);
  const searchPlatform = "dominos india";

  console.log("🚀 Launching Cloudflare-hardened persistent context...");

  // FIX 1: Use launchPersistentContext instead of standard 'page' fixture 
  // This is the only native way to fully scrub 'navigator.webdriver'
  const context = await playwright.chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1366,768',
      '--disable-popup-blocking'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const solveCloudflareIfNeeded = async () => {
    const cloudflareIframe = page.locator('iframe[src*="challenges.cloudflare.com"]').first();
    try {
      if (await cloudflareIframe.isVisible({ timeout: 4000 }).catch(() => false)) {
        console.log("⚠️ Cloudflare Turnstile challenge detected! Solving...");
        await delay(5000);
        const iframeBox = await cloudflareIframe.boundingBox();
        if (iframeBox) {
          const targetX = iframeBox.x + 35;
          const targetY = iframeBox.y + (iframeBox.height / 2);
          console.log(`🎯 Moving mouse to coordinates: X=${targetX}, Y=${targetY}`);
          await page.mouse.move(targetX, targetY, { steps: 15 });
          await delay(200);
          await page.mouse.down();
          await delay(120);
          await page.mouse.up();
          console.log("✅ Clicked Turnstile frame container.");
          await delay(5000);
        }
      }
    } catch (e) {
      console.log("Bypassed Cloudflare or timed out.", e.message);
    }
  };


  try {
    await page.goto("https://www.wethrift.com/", { waitUntil: 'commit' });
    await delay(1000);

    const searchInput = page.getByPlaceholder('Search for a store').first();

    await searchInput.waitFor({ state: 'visible', timeout: 3000 });

    await searchInput.fill(searchPlatform);

    await page.getByText("Dominos Pizza India").first().click();

    await page.waitForLoadState('domcontentloaded');

    await solveCloudflareIfNeeded();

    console.log("Current page URL before click:", page.url());

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Show Code' }).first().click()
    ]);

    console.log("New tab opened. URL:", newPage.url());

    await newPage.waitForLoadState('domcontentloaded');

    await newPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(2000);

    await newPage.locator('button:has-text("Copy")').first().waitFor({ state: 'attached', timeout: 8000 }).catch(() => null);

    const coupons = await newPage.evaluate(() => {
      const copyButtons = Array.from(document.querySelectorAll('button')).filter(btn => btn.textContent?.trim() === 'Copy');

      return copyButtons.map(btn => {
        const wrapper = btn.parentElement;
        if (!wrapper) return '';
        const textContainer = wrapper.querySelector('div, span');
        return textContainer ? textContainer.textContent?.trim() || '' : '';
      }).filter(code => code.length > 0 && code !== 'Copy');
    });

    console.log("All Extracted Coupons:", coupons);

    await newPage.close().catch(() => { });

    await page.bringToFront();

    if (!page.url().includes('dominos.co.in')) {
      await page.goto("https://www.dominos.co.in/", { waitUntil: 'domcontentloaded' }).catch(() => null);
    } else {
      await page.waitForLoadState('domcontentloaded').catch(() => null);
    }

    await page.getByText("ORDER ONLINE NOW").click();

    await expect(page.getByText("skip")).toBeVisible({ timeout: 5000 });
    await page.getByText("skip").click();

    await expect(page.getByText("Ask Later")).toBeVisible({ timeout: 5000 });

    await page.getByText("Ask Later").click();

    await page.getByText("Pizza Mania").click();

    await page.waitForTimeout(3000);

    const pizzasToAdd = ['Classic', 'Onion', 'Paneer & Capsicum with Videshi Hot Sauce', 'Golden Corn'];

    for (const pizza of pizzasToAdd) {
      const targetCard = page.locator('.card-content').filter({
        has: page.locator('.pizza-title').getByText(pizza, { exact: true })
      });
      await targetCard.getByRole('button', { name: 'Add +' }).first().click();
    }

    await expect(page.getByText("View Cart")).toBeVisible({ timeout: 1000 });

    await page.getByText("View Cart").click();

    await expect(page.getByText("Cart").first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText("View All Offers")).toBeVisible();

    await page.getByText("View All Offers").click();

    await expect(page.getByPlaceholder("Type Offer code here…")).toBeVisible();

    const couponStatus: { coupon: string; status: 'SUCCESS' | 'FAILED'; details: string }[] = [];

    for (const element of coupons) {
      try {
        console.log(`Applying coupon: ${element}`);

        const input = page.getByPlaceholder("Type Offer code here…");
        await input.fill(element);

        await page.getByRole("button", { name: "Apply" }).first().click();

        await page.waitForTimeout(2000);

        const errorMsg = page.locator('[class*="OffersErrorMsg"], p:has-text("invalid"), p:has-text("expired"), span:has-text("invalid"), span:has-text("expired"), div:has-text("invalid"), div:has-text("expired")').first();
        const errorVisible = await errorMsg.isVisible().catch(() => false);

        if (errorVisible) {
          const errorText = await errorMsg.innerText().catch(() => 'Coupon invalid/expired');
          console.log(`Coupon ${element} FAILED: ${errorText}`);
          couponStatus.push({ coupon: element, status: 'FAILED', details: errorText });

          await input.fill('');
        } else {

          let discountText = "Coupon Applied Successfully";

          const discountAppliedRow = page.locator('div:has-text("Discount Applied")').first();
          if (await discountAppliedRow.isVisible().catch(() => false)) {
            const rawDiscount = await discountAppliedRow.innerText().catch(() => '');
            discountText = rawDiscount.trim().replace(/\n/g, ' ');
          }

          console.log(`Coupon ${element} SUCCESS: ${discountText}`);
          couponStatus.push({ coupon: element, status: 'SUCCESS', details: discountText });

          // Go back to coupons/offers list page (click on 'View other offers' or 'Remove' coupon to try next)
          const viewOtherBtn = page.getByRole("link", { name: "View other offers" });
          const viewOtherVisible = await viewOtherBtn.isVisible().catch(() => false);
          if (viewOtherVisible) {
            await viewOtherBtn.click();
          } else {
            // If we are on checkout, we might need to click "Remove" first, then click "View other offers"
            const removeBtn = page.locator('span:has-text("Remove"), button:has-text("Remove")');
            if (await removeBtn.isVisible().catch(() => false)) {
              await removeBtn.click();
              await page.waitForTimeout(1000);
              await page.getByText("View All Offers").click().catch(() => null);
            }
          }
        }
      } catch (e) {
        console.log(`Error testing coupon ${element}: ${e.message}`);
        couponStatus.push({ coupon: element, status: 'FAILED', details: e.message });
        // Reset input in case of unexpected state
        await page.getByPlaceholder("Type Offer code here...").fill('').catch(() => null);
      }
    }

    console.log("--- FINAL COUPON VERIFICATION ---");
    console.table(couponStatus);

  } catch (error) {
    console.error("❌ Execution terminated unexpectedly:", error.message);
  } finally {
    await context.close();
  }


});
