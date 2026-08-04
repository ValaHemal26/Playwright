const express = require('express');
const { chromium } = require('@playwright/test');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Helper for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enable CORS for cross-origin frontend requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// Serves a simple health check status at root
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'scraper-backend' });
});

app.get('/api/scrape', async (req, res) => {
  // Setup Server-Sent Events headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  const sendLog = (message, type = 'info', data = null) => {
    res.write(`data: ${JSON.stringify({ message, type, data })}\n\n`);
  };

  const site = req.query.site || 'wethrift';
  const minCartValue = parseInt(req.query.minCartValue) || 300;
  const customCouponsInput = req.query.customCoupons || '';
  const headed = req.query.headed === 'true';

  let browser = null;
  let context = null;
  let browserClosed = false;

  try {
    let coupons = [];

    // Parse custom coupons if provided
    if (customCouponsInput.trim()) {
      coupons = customCouponsInput
        .split(/[\n,]/)
        .map(c => c.trim().toUpperCase())
        .filter(c => c.length > 0);
      
      sendLog(`📝 Using ${coupons.length} custom user-provided coupons. Skipping scraper step.`, 'info');
    }

    // Launch browser (either connect to remote WebSocket or launch locally)
    let wsUrl = process.env.BROWSER_WS_URL || req.query.wsUrl;
    if (wsUrl && !wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
      wsUrl = `wss://chrome.browserless.io/chromium?token=${wsUrl}&stealth=true&blockAds=true`;
    }
    let page;

    if (wsUrl) {
      sendLog(`🌐 Connecting to remote browser WebSocket...`, 'info');
      if (wsUrl.includes('browserless.io') && !wsUrl.includes('/playwright')) {
        browser = await chromium.connectOverCDP(wsUrl);
        context = browser.contexts()[0] || await browser.newContext({
          viewport: { width: 1366, height: 768 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        page = context.pages()[0] || await context.newPage();
      } else {
        browser = await chromium.connect({ wsEndpoint: wsUrl });
        context = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        page = await context.newPage();
      }
    } else if (process.env.VERCEL) {
      throw new Error("Running on Vercel requires a remote browser. Please set the BROWSER_WS_URL environment variable in your Vercel Project Settings (e.g., from Browserless.io).");
    } else {
      sendLog('🚀 Launching local persistent context...', 'info');
      context = await chromium.launchPersistentContext('', {
        headless: !headed,
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
      page = await context.newPage();
    }

    // Extra Runtime Security Bypass
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Cloudflare Solver Helper
    const solveCloudflareIfNeeded = async (targetPage) => {
      const cloudflareIframe = targetPage.locator('iframe[src*="challenges.cloudflare.com"]').first();
      try {
        if (await cloudflareIframe.isVisible({ timeout: 4000 }).catch(() => false)) {
          sendLog('⚠️ Cloudflare Turnstile challenge detected! Solving...', 'warning');
          await delay(4000);
          const iframeBox = await cloudflareIframe.boundingBox();
          if (iframeBox) {
            const targetX = iframeBox.x + 35;
            const targetY = iframeBox.y + (iframeBox.height / 2);
            await targetPage.mouse.move(targetX, targetY, { steps: 15 });
            await delay(200);
            await targetPage.mouse.down();
            await delay(120);
            await targetPage.mouse.up();
            sendLog('✅ Clicked Turnstile frame container.', 'success');
            await delay(4000);
          }
        }
      } catch (e) {
        sendLog(`Bypassed Cloudflare or timed out: ${e.message}`, 'info');
      }
    };

    // Scrape coupons if not custom provided
    if (coupons.length === 0) {
      if (site === 'wethrift') {
        sendLog("🌐 Navigating directly to Wethrift Domino's India page...", 'info');
        await page.goto("https://www.wethrift.com/dominos-pizza-india", { waitUntil: 'commit' });
        await delay(2000);
        await solveCloudflareIfNeeded(page);

        sendLog('👉 Clicking "Show Code" to open the coupon detail tab...', 'info');

        // Listen for new tab/page
        const [newPage] = await Promise.all([
          context.waitForEvent('page'),
          page.getByRole('button', { name: 'Show Code' }).first().click()
        ]);

        sendLog('📂 New tab opened. Preparing to extract codes...', 'info');
        await newPage.waitForLoadState('domcontentloaded');
        await solveCloudflareIfNeeded(newPage);

        // Scroll to trigger lazy rendering of table
        await newPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await delay(2000);

        await newPage.locator('button:has-text("Copy")').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => null);

        coupons = await newPage.evaluate(() => {
          const copyButtons = Array.from(document.querySelectorAll('button')).filter(btn => btn.textContent?.trim() === 'Copy');
          return copyButtons.map(btn => {
            const wrapper = btn.parentElement;
            if (!wrapper) return '';
            const textContainer = wrapper.querySelector('div, span');
            return textContainer ? textContainer.textContent?.trim() || '' : '';
          }).filter(code => code.length > 0 && code !== 'Copy');
        });

        sendLog(`🎉 Scraped ${coupons.length} unique coupons from wethrift.com`, 'success', coupons);
        await newPage.close().catch(() => { });
      } else {
        // grabon.in Scraping
        sendLog('🌐 Navigating to grabon.in...', 'info');
        await page.goto("https://www.grabon.in/", { waitUntil: 'commit' });
        await delay(1000);

        const searchInput = page.getByPlaceholder('Search for brands, categories').first();
        await searchInput.waitFor({ state: 'visible', timeout: 5000 });
        await searchInput.fill('dominos');
        await searchInput.pressSequentially(" ", { delay: 100 });

        sendLog('🔍 Loading search suggestions...', 'info');
        await page.locator('p, span, a').filter({ hasText: /^dominos$/i }).first().click();

        await page.waitForLoadState('domcontentloaded');
        await solveCloudflareIfNeeded(page);

        sendLog('⏳ Waiting for store page to load...', 'info');
        const cards = page.locator('.gcbr, [id^="cpn_"]');
        await cards.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
        const cardCount = await cards.count();

        sendLog(`📂 Extracting coupon codes from ${cardCount} coupon cards...`, 'info');

        coupons = await page.evaluate(() => {
          const cardsList = Array.from(document.querySelectorAll('.gcbr, [id^="cpn_"]'));
          const list = [];
          cardsList.forEach(card => {
            const codeEls = card.querySelectorAll('[data-code], [data-inner-text], [data-clip]');
            codeEls.forEach(el => {
              const code = el.getAttribute('data-code') || el.getAttribute('data-inner-text') || el.getAttribute('data-clip');
              if (code && code.trim() && !/Unlock|Show|Deal|Redeem|Offer/i.test(code)) {
                const clean = code.trim().toUpperCase();
                if (!list.includes(clean)) list.push(clean);
              }
            });
          });
          return list;
        });

        sendLog(`🎉 Scraped ${coupons.length} unique coupons from grabon.in`, 'success', coupons);
      }
    }

    if (coupons.length === 0) {
      sendLog('❌ No coupons found to verify. Aborting.', 'error');
      res.end();
      await context.close().catch(() => { });
      browserClosed = true;
      return;
    }

    // Now switch to Domino's validation
    sendLog("🍕 Opening Domino's Pizza India...", 'info');
    await page.bringToFront();
    await page.goto("https://www.dominos.co.in/", { waitUntil: 'domcontentloaded' }).catch(() => null);

    sendLog('🛒 Navigating to Online Ordering system...', 'info');
    await page.getByText("ORDER ONLINE NOW").click();

    await page.getByText("skip").waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    if (await page.getByText("skip").isVisible().catch(() => false)) {
      await page.getByText("skip").click();
    }

    await page.getByText("Ask Later").waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if (await page.getByText("Ask Later").isVisible().catch(() => false)) {
      await page.getByText("Ask Later").click();
    }

    // Handle location selection if requested
    const addressInput = page.getByPlaceholder(/Enter your delivery address|Enter delivery address|Enter your area|select location/i).first();
    try {
      if (await addressInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        sendLog('📍 Location prompt detected. Setting default delivery location...', 'info');
        await addressInput.click();
        await addressInput.fill('Connaught Place, New Delhi');
        await page.waitForTimeout(2000);
        
        // Try clicking a suggestion or pressing ArrowDown + Enter
        const suggestion = page.locator('[class*="suggestion"], [class*="Suggestion"], [class*="search-result"]').first();
        if (await suggestion.isVisible({ timeout: 2000 }).catch(() => false)) {
          await suggestion.click();
        } else {
          await addressInput.press('ArrowDown');
          await page.waitForTimeout(500);
          await addressInput.press('Enter');
        }
        await page.waitForTimeout(4000);
      }
    } catch (err) {
      sendLog(`Info: Location selection step: ${err.message}`, 'info');
    }

    sendLog('🍕 Navigating to Pizza Mania menu...', 'info');
    await page.getByText("Pizza Mania").click();
    await page.waitForTimeout(3000);

    // Add pizzas to hit the minimum cart value
    sendLog(`🛒 Adding items to meet minimum cart value of ₹${minCartValue}...`, 'info');
    const pizzasToAdd = ['Classic', 'Onion', 'Paneer & Capsicum with Videshi Hot Sauce', 'Golden Corn', 'Classic Hand Tossed', 'Cheese N Corn'];
    let currentSubtotal = 0;

    for (const pizza of pizzasToAdd) {
      if (currentSubtotal >= minCartValue) {
        sendLog(`✅ Cart subtotal of ₹${currentSubtotal} meets/exceeds requirement. Proceeding to checkout.`, 'success');
        break;
      }

      const targetCard = page.locator('.card-content').filter({
        has: page.locator('.pizza-title').getByText(pizza, { exact: true })
      });

      if (await targetCard.isVisible().catch(() => false)) {
        sendLog(`Adding ${pizza}...`, 'info');
        await targetCard.getByRole('button', { name: 'Add +' }).first().click();
        await page.waitForTimeout(1000);

        // Read subtotal
        const viewCartText = await page.locator('div:has-text("View Cart"), button:has-text("View Cart")').first().innerText().catch(() => '');
        const match = viewCartText.match(/₹\s*(\d+)/);
        if (match) {
          currentSubtotal = parseInt(match[1]);
          sendLog(`Current subtotal: ₹${currentSubtotal}`, 'info');
        } else {
          currentSubtotal += 100; // estimated fallback increment
        }
      }
    }

    sendLog('🛒 Going to Cart...', 'info');
    await page.getByText("View Cart").click();

    sendLog('⏳ Waiting for Cart screen...', 'info');
    await page.locator('div:has-text("Cart")').first().waitFor({ state: 'visible', timeout: 10000 });

    sendLog('🎟️ Opening offers modal...', 'info');
    await page.getByText("View All Offers").click();
    await page.getByPlaceholder("Type Offer code here…").waitFor({ state: 'visible', timeout: 5000 });

    // Validate coupons loop
    const results = [];
    for (const coupon of coupons) {
      sendLog(`Applying Coupon: ${coupon}...`, 'info');
      try {
        const input = page.getByPlaceholder("Type Offer code here…");
        await input.fill(coupon);
        await page.getByRole("button", { name: "Apply" }).first().click();

        await page.waitForTimeout(2000);

        // Check for error element
        const errorMsg = page.locator('[class*="OffersErrorMsg"], p:has-text("invalid"), p:has-text("expired"), span:has-text("invalid"), span:has-text("expired"), div:has-text("invalid"), div:has-text("expired")').first();
        const errorVisible = await errorMsg.isVisible().catch(() => false);

        if (errorVisible) {
          const errorText = await errorMsg.innerText().catch(() => 'Coupon invalid/expired');
          sendLog(`Coupon ${coupon} FAILED: ${errorText}`, 'error');
          results.push({ coupon, status: 'FAILED', details: errorText });
          await input.fill('');
        } else {
          let discountText = "Coupon Applied Successfully";
          const discountAppliedRow = page.locator('div:has-text("Discount Applied")').first();
          if (await discountAppliedRow.isVisible().catch(() => false)) {
            const rawDiscount = await discountAppliedRow.innerText().catch(() => '');
            discountText = rawDiscount.trim().replace(/\n/g, ' ');
          }

          sendLog(`Coupon ${coupon} SUCCESS: ${discountText}`, 'success');
          results.push({ coupon, status: 'SUCCESS', details: discountText });

          // Reset the coupon state for next attempt
          const viewOtherBtn = page.getByRole("link", { name: "View other offers" });
          if (await viewOtherBtn.isVisible().catch(() => false)) {
            await viewOtherBtn.click();
          } else {
            const removeBtn = page.locator('span:has-text("Remove"), button:has-text("Remove")');
            if (await removeBtn.isVisible().catch(() => false)) {
              await removeBtn.click();
              await page.waitForTimeout(1000);
              await page.getByText("View All Offers").click().catch(() => null);
            }
          }
        }
      } catch (e) {
        sendLog(`Error applying coupon ${coupon}: ${e.message}`, 'error');
        results.push({ coupon, status: 'FAILED', details: e.message });
        await page.getByPlaceholder("Type Offer code here…").fill('').catch(() => null);
      }

      // Stream the full updated results array to the client
      res.write(`data: ${JSON.stringify({ type: 'results', data: results })}\n\n`);
    }

    sendLog('🏁 Coupon verification run completed!', 'success');
    res.end();
  } catch (err) {
    sendLog(`❌ Execution error: ${err.message}`, 'error');
    res.end();
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
});

// Fallback for undefined requests
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
