import { test, expect } from '@playwright/test';

test('new test', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("https://www.grabon.in/");

  await page.getByPlaceholder('Search for brands, categories').click();

  await expect(page.getByPlaceholder('Search for brands, categories')).toBeVisible({ timeout: 5000 });

  const searchEle = page.getByPlaceholder('Search for stores, coupons & offers...');

  const brandName = "dominos";

  await searchEle.fill(brandName);

  await searchEle.pressSequentially(" ", { delay: 100 });

  // Click on the matching suggestion matching the brand name dynamically
  await page.locator('p, span, a').filter({ hasText: new RegExp(`^${brandName}$`, 'i') }).first().click();

  // Dynamically expect the header text on the brand coupon page
  await expect(page.locator('h1, h2, div').filter({ hasText: new RegExp(`${brandName}`, 'i') }).first()).toBeVisible({ timeout: 10000 });

  // 1. Find all coupon card containers
  const cards = page.locator('.gcbr, [id^="cpn_"]');
  await cards.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
  const totalCardsCount = await cards.count();
  console.log(`Found ${totalCardsCount} total offer cards.`);

  const coupons: string[] = [];

  // 2. Extract coupon codes dynamically from the DOM (super-fast, no clicks or page navigations needed!)
  for (let i = 0; i < totalCardsCount; i++) {
    const currentCard = cards.nth(i);
    try {
      // Find all elements inside the card containing a code attribute
      const codeElements = currentCard.locator('[data-code], [data-inner-text], [data-clip]');
      const codeElementsCount = await codeElements.count();

      for (let j = 0; j < codeElementsCount; j++) {
        const el = codeElements.nth(j);
        const codeAttr = await el.getAttribute('data-code').catch(() => null) ||
          await el.getAttribute('data-inner-text').catch(() => null) ||
          await el.getAttribute('data-clip').catch(() => null);

        if (codeAttr && codeAttr.trim() && !/Unlock|Show|Deal|Redeem|Offer/i.test(codeAttr)) {
          const cleanCode = codeAttr.trim();
          if (!coupons.includes(cleanCode)) {
            console.log(`Extracted coupon code: ${cleanCode}`);
            coupons.push(cleanCode);
          }
        }
      }
    } catch (err) {
      console.log(`Error processing card index ${i}: ${err.message}`);
    }
  }

  console.log(`Successfully collected ${coupons.length} unique coupons:`, coupons);



  await page.goto("https://www.dominos.co.in/");

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

      // Click Apply button
      await page.getByRole("button", { name: "Apply" }).first().click();

      // Wait a short time for coupon resolution
      await page.waitForTimeout(2000);

      // Check if there is an error message under the input box
      // From the third screenshot: "Coupon Code is invalid or expired" (red text)
      const errorMsg = page.locator('span:has-text("invalid"), span:has-text("expired"), div:has-text("invalid"), div:has-text("expired")').first();
      const errorVisible = await errorMsg.isVisible().catch(() => false);

      if (errorVisible) {
        const errorText = await errorMsg.innerText().catch(() => 'Coupon invalid/expired');
        console.log(`Coupon ${element} FAILED: ${errorText}`);
        couponStatus.push({ coupon: element, status: 'FAILED', details: errorText });

        // Clear input to try next code
        await input.fill('');
      } else {
        // If no error, check if coupon is applied and read the discount
        // Looking at the 1st and 4th screenshots, the savings container displays "GET30 Applied" or "Discount Applied - ₹30"
        let discountText = "Coupon Applied Successfully";

        // Try to read the discount amount from the Bill details section
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

});

