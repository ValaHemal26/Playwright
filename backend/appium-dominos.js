const { chromium } = require('playwright');
const { remote } = require('webdriverio');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');

const detectedSdk = (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : 'C:\\Users\\Hemal\\AppData\\Local\\Android\\Sdk');
if (!process.env.ANDROID_HOME || !fs.existsSync(process.env.ANDROID_HOME)) {
  process.env.ANDROID_HOME = detectedSdk;
}
if (!process.env.ANDROID_SDK_ROOT || !fs.existsSync(process.env.ANDROID_SDK_ROOT)) {
  process.env.ANDROID_SDK_ROOT = detectedSdk;
}

const APP_PACKAGE = process.env.APP_PACKAGE || 'com.Dominos';
const APP_ACTIVITY = process.env.APP_ACTIVITY || 'com.Dominos.activity.alias.LauncherDefaultAlias';
const MIN_CART_VALUE = parseInt(process.env.MIN_CART_VALUE || '400', 10);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let appiumProcess = null;
let spawnedAppium = false;

// Helper to check if port is already in use
function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
}

// Helper to wait for port to open
function waitForPort(port, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

// Helper to start Appium Server
async function startAppiumServer(port = 4725) {
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : 'C:\\Users\\Hemal\\AppData\\Local\\Android\\Sdk');

  // If port is in use, attempt to kill old appium instance to ensure clean SDK environment
  const inUse = await isPortInUse(port);
  if (inUse) {
    try {
      const { execSync } = require('child_process');
      const netstat = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      for (const line of netstat.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            console.log(`🧹 [Appium] Cleaning up old server process on port ${port} (PID ${pid})...`);
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            await delay(1500);
          }
        }
      }
    } catch (e) { }
  }

  console.log(`\n🚀 [Appium] Starting Appium server programmatically on port ${port} (SDK: ${androidHome})...`);
  spawnedAppium = true;
  appiumProcess = spawn('npx', ['appium', '--port', String(port), '--allow-cors'], {
    env: {
      ...process.env,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
    },
    cwd: __dirname, // Run in backend directory to find installed drivers (uiautomator2)
    shell: true,
    stdio: 'inherit'
  });

  appiumProcess.on('error', (err) => {
    console.error('❌ [Appium] Failed to start Appium process:', err);
  });

  try {
    await waitForPort(port, 90000);
    console.log(`✅ [Appium] Programmatic Appium server is up and listening on port ${port}.`);
  } catch (err) {
    console.error(`❌ [Appium] Appium server failed to start on port ${port}:`, err.message);
    throw err;
  }
}

// Helper to stop Appium Server
function stopAppiumServer() {
  if (appiumProcess && spawnedAppium) {
    console.log('\n🛑 [Appium] Stopping programmatically spawned Appium server...');
    appiumProcess.kill('SIGINT');
  }
}

// Helper to dismiss common overlays/popups
async function dismissPopups(driver) {
  const popupSelectors = [
    { selector: 'android=new UiSelector().resourceId("com.Dominos:id/tv_cta")', desc: 'Allow Location CTA' },
    { selector: 'android=new UiSelector().textContains("Allow")', desc: 'System Allow Button' },
    { selector: 'android=new UiSelector().text("Yay! Thanks")', desc: 'Yay Thanks Free Delivery Popup' },
    { selector: 'android=new UiSelector().text("OK")', desc: 'OK Alert Dismiss' },
    { selector: 'android=new UiSelector().text("Ok")', desc: 'Ok Alert Dismiss' },
    { selector: 'android=new UiSelector().text("No, thanks")', desc: 'Google Location Accuracy No thanks button' },
    { selector: 'android=new UiSelector().text("No thanks")', desc: 'Google Location Accuracy No thanks button' },
    { selector: 'android=new UiSelector().text("NO THANKS")', desc: 'Google Location Accuracy No thanks button' },
    { selector: 'android=new UiSelector().resourceId("com.Dominos:id/ivClose")', desc: 'Close Ad Banner' },
    { selector: 'android=new UiSelector().resourceId("com.Dominos:id/iv_customisation_crossTap")', desc: 'Close Customize Modal' }
  ];

  for (const item of popupSelectors) {
    try {
      const els = await driver.$$(item.selector).catch(() => []);
      for (const el of els) {
        if (await el.isDisplayed().catch(() => false)) {
          await el.click().catch(() => null);
          console.log(`🛡️ [Popup Handler] Dismissed: ${item.desc}`);
          await delay(1000);
        }
      }
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Scrape coupon codes using Playwright (or load from local coupons.json cache)
 */
async function scrapeCoupons() {
  if (process.env.CUSTOM_COUPONS) {
    const list = process.env.CUSTOM_COUPONS.split(',').map(c => c.trim()).filter(Boolean);
    if (list.length > 0) {
      console.log(`⚡ [Coupons] Loaded ${list.length} custom user-provided coupons.`);
      return list;
    }
  }

  const couponSource = process.env.COUPON_SOURCE || 'cache';
  const jsonPath = path.join(__dirname, 'coupons.json');

  // Check if coupons.json exists and read from cache first
  if (couponSource !== 'scrape' && fs.existsSync(jsonPath)) {
    try {
      const cachedData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (Array.isArray(cachedData) && cachedData.length > 0) {
        console.log(`⚡ [Coupons] Loaded ${cachedData.length} coupons directly from local cache (coupons.json).`);
        return cachedData;
      }
    } catch (e) {
      console.log('⚠️ [Coupons] Could not parse local coupons.json cache. Falling back to live scraping...');
    }
  }

  console.log('🌐 [Playwright] Launching browser to scrape coupons from GrabOn...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const coupons = [];

  try {
    await page.goto('https://www.grabon.in/dominos-coupons/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('🌐 [Playwright] Page loaded. Parsing offer cards...');

    const cards = page.locator('.gcbr, [id^="cpn_"]');
    await cards.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
    const count = await cards.count();
    console.log(`🌐 [Playwright] Found ${count} total offer cards.`);

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      try {
        const codeElements = card.locator('[data-code], [data-inner-text], [data-clip]');
        const elCount = await codeElements.count();
        for (let j = 0; j < elCount; j++) {
          const el = codeElements.nth(j);
          const val = await el.getAttribute('data-code').catch(() => null) ||
            await el.getAttribute('data-inner-text').catch(() => null) ||
            await el.getAttribute('data-clip').catch(() => null);

          if (val && val.trim() && !/Unlock|Show|Deal|Redeem|Offer/i.test(val)) {
            const code = val.trim();
            if (!coupons.includes(code)) {
              console.log(`✨ [Playwright] Extracted coupon code: ${code}`);
              coupons.push(code);
            }
          }
        }
      } catch (err) { }
    }

    // Cache to coupons.json
    fs.writeFileSync(jsonPath, JSON.stringify(coupons, null, 2));
    console.log(`💾 [Coupons] Saved ${coupons.length} scraped coupons to backend/coupons.json`);
  } catch (error) {
    console.error('❌ [Playwright] Error while scraping:', error.message);
  } finally {
    await browser.close();
  }

  return coupons;
}

/**
 * Find element using a list of fallback selectors with fast per-selector timeout
 */
async function findElementWithFallbacks(driver, selectors, description = 'element', timeoutMs = 1500) {
  for (const sel of selectors) {
    try {
      const el = await driver.$(sel);
      if (await el.waitForExist({ timeout: timeoutMs }).catch(() => false)) {
        if (await el.isDisplayed().catch(() => false)) {
          return el;
        }
      }
    } catch (e) {
      // Try next selector
    }
  }
  throw new Error(`Could not find ${description} using selectors: ${JSON.stringify(selectors)}`);
}

const { execSync } = require('child_process');

function getOnlineUdid() {
  if (process.env.TARGET_UDID && process.env.TARGET_UDID.trim()) {
    return process.env.TARGET_UDID.trim();
  }
  try {
    const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : 'C:\\Users\\Hemal\\AppData\\Local\\Android\\Sdk');
    const adbExe = path.join(androidHome, 'platform-tools', 'adb.exe');
    const adbCmd = fs.existsSync(adbExe) ? `"${adbExe}"` : 'adb';
    const output = execSync(`${adbCmd} devices`, { encoding: 'utf8' });
    const lines = output.split('\n');
    const devices = [];
    for (const line of lines) {
      if (line.includes('\tdevice')) {
        devices.push(line.split('\t')[0].trim());
      }
    }
    // Prefer IP address endpoint over mDNS auto-discovered names
    const ipDevice = devices.find(d => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(d));
    return ipDevice || devices[0];
  } catch (e) { }
  return undefined;
}

/**
 * Perform Appium coupon testing
 */
async function testCouponsOnMobile(coupons) {
  if (coupons.length === 0) {
    console.log('⚠️ No coupons to test. Exiting mobile phase.');
    return;
  }

  const onlineUdid = getOnlineUdid();
  console.log(`\n📱 [Appium] Target Device UDID: ${onlineUdid || 'Autodetect'}`);

  console.log('\n📱 [Appium] Starting Appium session...');
  const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Android Device',
    ...(onlineUdid ? { 'appium:udid': onlineUdid } : {}),
    'appium:appPackage': APP_PACKAGE,
    'appium:appActivity': APP_ACTIVITY,
    'appium:noReset': true, // Retains app state & logged in status
    'appium:dontStopAppOnReset': true, // DONT stop/restart the app if it is already running!
    'appium:newCommandTimeout': 300,
    'appium:ignoreHiddenApiPolicyError': true,
    'appium:adbExecTimeout': 60000,
    'appium:uiautomator2ServerLaunchTimeout': 60000,
    'appium:settings[implicitWaitTimeout]': 0,
    'appium:settings[waitForIdleTimeout]': 0,
  };

  const driver = await remote({
    hostname: '127.0.0.1',
    port: 4725,
    path: '/',
    capabilities,
  });

  // Force server-side implicit wait to 0ms immediately
  try {
    await driver.updateSettings({ implicitWaitTimeout: 0, waitForIdleTimeout: 0 }).catch(() => null);
  } catch (e) { }

  // CRITICAL FIX: Set implicit wait to 0ms to eliminate 20-second delays on missing fallback selectors
  try {
    await driver.setTimeouts({ implicit: 0 });
  } catch (e) {
    try { await driver.setTimeout({ implicit: 0 }); } catch (err) { }
  }

  const couponStatus = [];

  try {
    console.log('📱 [Appium] Dominos app connected successfully.');
    console.log('📱 [Appium] Bringing Dominos app to foreground...');
    await driver.activateApp(APP_PACKAGE).catch(() => null);
    await delay(2000);

    // Save exact XML screen dump to window_dump.xml for locators inspection
    try {
      const pageSourceXml = await driver.getPageSource();
      require('fs').writeFileSync('d:\\playwright\\window_dump.xml', pageSourceXml);
      console.log('📄 [Appium] Saved live screen UI hierarchy to: d:\\playwright\\window_dump.xml');
    } catch (e) { }

    // Fast Non-Blocking Helper: Click first matching element if visible
    const clickFast = async (selectors, desc) => {
      for (const sel of selectors) {
        try {
          const els = await driver.$$(sel);
          if (els && els.length > 0) {
            for (const el of els) {
              if (await el.isDisplayed().catch(() => false)) {
                await el.click().catch(() => null);
                console.log(`📱 [Appium] Tapped: ${desc}`);
                await delay(1500);
                return true;
              }
            }
          }
        } catch (e) { }
      }
      return false;
    };

    // Helper to natively scroll to a text element
    const scrollIntoViewByText = async (text) => {
      try {
        const sel = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(new UiSelector().text("${text}"))`;
        const el = await driver.$(sel);
        return await el.isDisplayed().catch(() => false);
      } catch (e) {
        return false;
      }
    };

    // Helper to scroll down once
    const scrollDownOnce = async () => {
      try {
        console.log('📱 [Appium] Scrolling down natively...');
        const sel = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollForward()`;
        await driver.$(sel);
        await delay(1000);
      } catch (e) {
        console.log('📱 [Appium] Native scroll failed. Attempting swipe gesture...');
        try {
          const size = await driver.getWindowSize();
          const startX = Math.floor(size.width * 0.5);
          const startY = Math.floor(size.height * 0.7);
          const endY = Math.floor(size.height * 0.3);
          await driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: startX, y: startY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerMove', duration: 1000, x: startX, y: endY },
              { type: 'pointerUp', button: 0 }
            ]
          }]);
          await delay(1000);
        } catch (err) {
          console.error('⚠️ [Appium] Swipe gesture failed:', err.message);
        }
      }
    };

    // Helper: Go back to Menu page from Cart
    const goBackToMenu = async () => {
      console.log('📱 [Appium] Navigating back to Menu...');
      const backArrowClicked = await clickFast([
        'android=new UiSelector().resourceId("com.Dominos:id/ivBack")',
        'android=new UiSelector().resourceId("com.Dominos:id/iv_back")',
        'android=new UiSelector().description("Back")',
        'android=new UiSelector().description("Navigate up")',
      ], 'Back Button');
      if (!backArrowClicked) {
        await driver.back().catch(() => null);
      }
      await delay(2000);
      await dismissPopups(driver);
    };

    // Helper: Navigate to Cart Screen
    const goToCartScreen = async () => {
      console.log('🛒 [Appium] Navigating to Cart Screen...');
      let opened = await clickFast([
        'android=new UiSelector().textContains("View Cart")',
        'android=new UiSelector().resourceId("com.Dominos:id/tv_cart_item_count")',
        'android=new UiSelector().resourceId("com.Dominos:id/ll_cart_view")',
        'android=new UiSelector().text("Cart")',
        '//*[@content-desc="Cart"]',
      ], 'View Cart Floating Bar / Cart Tab');

      if (opened) {
        await delay(2000);
        await dismissPopups(driver);
        return true;
      }

      opened = await clickFast([
        'android=new UiSelector().resourceId("com.Dominos:id/ivCart")',
        'android=new UiSelector().resourceId("com.Dominos:id/iv_cart")',
      ], 'Cart Icon');

      if (opened) {
        await delay(2000);
        await dismissPopups(driver);
        return true;
      }

      console.log('⚠️ [Appium] Could not navigate to Cart directly.');
      return false;
    };

    // Helper: Extract Cart Subtotal (excluding taxes/fees)
    const getCartSubtotal = async () => {
      console.log('🛒 [Appium] Attempting to find cart subtotal...');

      // Try to scroll to see the bill details
      await scrollIntoViewByText("Subtotal").catch(() => null);
      await scrollIntoViewByText("Item Value").catch(() => null);
      await scrollIntoViewByText("Item Total").catch(() => null);

      const possibleSelectors = [
        'android=new UiSelector().textContains("Subtotal")',
        'android=new UiSelector().textContains("Item Value")',
        'android=new UiSelector().textContains("Item Total")',
        'android=new UiSelector().resourceId("com.Dominos:id/tvSubtotal")',
        'android=new UiSelector().resourceId("com.Dominos:id/tv_subtotal")',
        'android=new UiSelector().resourceId("com.Dominos:id/tvSubTotal")',
      ];

      for (const sel of possibleSelectors) {
        try {
          const els = await driver.$$(sel);
          for (const el of els) {
            if (await el.isDisplayed().catch(() => false)) {
              const text = await el.getText().catch(() => '');
              console.log(`🛒 [Appium] Found potential subtotal text element: "${text}"`);

              const match = text.match(/₹\s*(\d+(\.\d+)?)/) || text.match(/(\d+(\.\d+)?)/);
              if (match) {
                const val = parseFloat(match[1]);
                console.log(`🛒 [Appium] Parsed subtotal: ₹${val}`);
                return val;
              }

              const parent = await el.$('..');
              const siblingTexts = await parent.$$('android.widget.TextView');
              for (const sib of siblingTexts) {
                const sibText = await sib.getText().catch(() => '');
                if (sibText !== text && (sibText.includes('₹') || /\d+/.test(sibText))) {
                  const matchSib = sibText.match(/₹\s*(\d+(\.\d+)?)/) || sibText.match(/(\d+(\.\d+)?)/);
                  if (matchSib) {
                    const val = parseFloat(matchSib[1]);
                    console.log(`🛒 [Appium] Parsed subtotal from sibling: ₹${val}`);
                    return val;
                  }
                }
              }
            }
          }
        } catch (e) {
          // Ignore
        }
      }

      // Check the View Cart bar as fallback
      const cartBarEls = await driver.$$('android=new UiSelector().textContains("Item")').catch(() => []);
      for (const el of cartBarEls) {
        if (await el.isDisplayed().catch(() => false)) {
          const text = await el.getText().catch(() => '');
          const match = text.match(/₹\s*(\d+(\.\d+)?)/) || text.match(/(\d+(\.\d+)?)/);
          if (match) {
            const val = parseFloat(match[1]);
            console.log(`🛒 [Appium] Parsed subtotal from View Cart bar: ₹${val}`);
            return val;
          }
        }
      }

      console.log('⚠️ [Appium] Could not determine subtotal. Defaulting to 0.');
      return 0;
    };

    // Helper: Ensure Cart has minimum subtotal (excluding taxes/fees)
    const ensureCartHasMinSubtotal = async (targetValue) => {
      console.log(`🛒 [Appium] Ensuring cart has at least ₹${targetValue} subtotal...`);

      let onCart = await goToCartScreen();
      let currentSubtotal = 0;

      if (onCart) {
        currentSubtotal = await getCartSubtotal();
        console.log(`🛒 [Appium] Current Cart Subtotal: ₹${currentSubtotal}`);
      } else {
        console.log('🛒 [Appium] Cart could not be opened. Assuming empty/low cart.');
      }

      if (currentSubtotal >= targetValue) {
        console.log(`✅ [Appium] Current subtotal (₹${currentSubtotal}) is already >= target (₹${targetValue}). Skipping item addition.`);
        return true;
      }

      console.log(`🛒 [Appium] Subtotal (₹${currentSubtotal}) is below target (₹${targetValue}). Going to menu to add items...`);

      if (onCart) {
        await goBackToMenu();
      }

      // Ensure we are in Veg Pizza/Menu category
      await clickFast([
        'android=new UiSelector().text("Veg Pizza")',
        'android=new UiSelector().text("Pizza Mania")',
        'android=new UiSelector().resourceId("com.Dominos:id/tab_1")',
      ], 'Veg Pizza / Menu Category');
      await delay(2000);
      await dismissPopups(driver);

      let attempts = 0;
      const maxAttempts = 8;

      while (currentSubtotal < targetValue && attempts < maxAttempts) {
        attempts++;
        console.log(`🍕 [Appium] Adding item loop (Attempt ${attempts}/${maxAttempts}). Current subtotal: ₹${currentSubtotal}`);

        let addBtns = await driver.$$('android=new UiSelector().text("ADD")').catch(() => []);
        if (addBtns.length === 0) {
          addBtns = await driver.$$('android=new UiSelector().textContains("Add")').catch(() => []);
        }

        if (addBtns.length > 0) {
          console.log('🍕 [Appium] Tapping "ADD" button...');
          await addBtns[0].click().catch(() => null);
          await delay(1500);

          await clickFast([
            'android=new UiSelector().textContains("Add")',
            'android=new UiSelector().textContains("ADD ITEM")',
            'android=new UiSelector().textContains("CONTINUE")',
          ], 'Modal Size/Crust Add Button');

          await delay(1000);
          await dismissPopups(driver);
        } else {
          console.log('🍕 [Appium] No ADD buttons visible. Scrolling down...');
          await scrollDownOnce();
        }

        // Try to read subtotal from the View Cart bar
        const cartBarEls = await driver.$$('android=new UiSelector().textContains("Item")').catch(() => []);
        let foundBar = false;
        for (const el of cartBarEls) {
          if (await el.isDisplayed().catch(() => false)) {
            const text = await el.getText().catch(() => '');
            const match = text.match(/₹\s*(\d+(\.\d+)?)/) || text.match(/(\d+(\.\d+)?)/);
            if (match) {
              currentSubtotal = parseFloat(match[1]);
              console.log(`🛒 [Appium] Updated subtotal from floating bar: ₹${currentSubtotal}`);
              foundBar = true;
              break;
            }
          }
        }

        if (!foundBar) {
          await scrollDownOnce();
        }
      }

      console.log('🛒 [Appium] Finished adding items. Navigating to Cart...');
      const openedCart = await goToCartScreen();
      if (openedCart) {
        currentSubtotal = await getCartSubtotal();
        console.log(`🛒 [Appium] Final verified Cart Subtotal: ₹${currentSubtotal}`);
      }

      return currentSubtotal >= targetValue;
    };

    // Helper: Navigate from Cart screen to Coupons screen
    const goToCouponsFromCart = async () => {
      const inputs = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
      if (inputs.length > 0 && await inputs[0].isDisplayed().catch(() => false)) {
        return true;
      }

      const clickedOffers = await clickFast([
        'android=new UiSelector().resourceId("com.Dominos:id/llCoupon")',
        'android=new UiSelector().resourceId("com.Dominos:id/tvCoupons")',
        'android=new UiSelector().text("Coupon Applied")',
        'android=new UiSelector().text("Coupons")',
        'android=new UiSelector().textContains("Coupons")',
        'android=new UiSelector().textContains("View all offers")',
        'android=new UiSelector().textContains("View All Offers")',
        'android=new UiSelector().textContains("offers")',
      ], 'View All Offers / Coupons Button');

      return clickedOffers;
    };

    // Ensure cart has items and navigate to Coupons screen
    await ensureCartHasMinSubtotal(MIN_CART_VALUE);
    await goToCouponsFromCart();

    console.log('\n🎟️ [Appium] Starting coupon verification loop matching video...');

    // Loop through coupon testing
    for (const coupon of coupons) {
      try {
        console.log(`\n🎫 Testing Coupon: ${coupon}`);

        // Ensure we are on Coupons screen
        await goToCouponsFromCart();

        // 1. Locate Promo Code Input Field
        let promoInputEls = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
        if (promoInputEls.length === 0 || !(await promoInputEls[0].isDisplayed().catch(() => false))) {
          console.log('⚠️ [Appium] Coupons input field not found on screen. Re-navigating...');
          await goToCouponsFromCart();
          // Fetch elements again after re-navigating
          promoInputEls = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
        }

        if (promoInputEls.length === 0) {
          throw new Error('Coupons input field (EditText) not found or not visible on screen. Are you on the Offers/Coupons page?');
        }

        const promoInput = promoInputEls[0];

        // Clear and fill coupon
        await promoInput.clearValue().catch(() => null);
        await promoInput.setValue(coupon);
        console.log(`📱 [Appium] Entered coupon code: ${coupon}`);

        // 2. Click Apply button
        const applyClicked = await clickFast([
          'android=new UiSelector().text("Apply")',
          'android=new UiSelector().text("APPLY")',
          'android=new UiSelector().resourceId("com.Dominos:id/apply_coupon_btn")',
        ], 'Apply Button');

        // await delay(3500); // Wait for resolution

        // 3. Determine Result (Success vs Failure)
        let status = 'FAILED';
        let details = 'Coupon invalid or not eligible';
        let discount = 0;

        // Check for Success overlay ("Yay! Thanks")
        const yayBtns = await driver.$$('android=new UiSelector().text("Yay! Thanks")').catch(() => []);
        const isSuccess = yayBtns.length > 0 && await yayBtns[0].isDisplayed().catch(() => false);

        if (isSuccess) {
          status = 'SUCCESS';

          // Extract discount text (e.g. "You saved ₹100 with this offer")
          const savedEls = await driver.$$('android=new UiSelector().textContains("saved")').catch(() => []);
          if (savedEls.length > 0) {
            const text = await savedEls[0].getText().catch(() => '');
            details = text || 'Coupon Applied Successfully';
            const match = text.match(/₹\s*(\d+)/) || text.match(/(\d+)/);
            if (match) {
              discount = parseInt(match[1], 10);
            }
          } else {
            details = 'Coupon Applied Successfully';
          }

          console.log(`🎉 [Appium] Coupon SUCCESS: ${details} (Discount: ₹${discount})`);
          couponStatus.push({ coupon, status, discount, details });

          // Tap "Yay! Thanks" to dismiss success modal
          await yayBtns[0].click().catch(() => null);
          await delay(2000);

          // We are back on Cart page. Remove applied coupon so next code can be tested.
          console.log('📱 [Appium] Removing applied coupon to prepare for next test...');
          const removed = await clickFast([
            'android=new UiSelector().text("Remove")',
            'android=new UiSelector().text("REMOVE")',
            'android=new UiSelector().resourceId("com.Dominos:id/remove_coupon")',
          ], 'Remove Coupon Link');

          if (removed) {
            await delay(2000);
          }
        } else {
          // Check for Error message (e.g. "Something went wrong. Please try again...")
          const errEls = await driver.$$('android=new UiSelector().textContains("Something went wrong")').catch(() => []);
          if (errEls.length > 0 && await errEls[0].isDisplayed().catch(() => false)) {
            details = await errEls[0].getText().catch(() => 'Something went wrong. Please try again.');
          } else {
            const genericErrEls = await driver.$$('android=new UiSelector().textContains("invalid")').catch(() => []);
            if (genericErrEls.length > 0 && await genericErrEls[0].isDisplayed().catch(() => false)) {
              details = await genericErrEls[0].getText().catch(() => 'Invalid coupon');
            }
          }

          console.log(`❌ [Appium] Coupon FAILED: ${details}`);
          couponStatus.push({ coupon, status, discount, details });

          // Dismiss error button if present ("OK" / "Ok")
          await clickFast(['android=new UiSelector().text("OK")', 'android=new UiSelector().text("Ok")'], 'OK Error Dismiss Button');

          // Clear input for next iteration
          if (promoInput) {
            await promoInput.clearValue().catch(() => null);
          }
        }

      } catch (err) {
        console.error(`⚠️ [Appium] Error testing coupon "${coupon}":`, err.message);
        couponStatus.push({ coupon, status: 'ERROR', discount: 0, details: err.message });
      }
    }

  } catch (err) {
    console.error('❌ [Appium] Automation flow crashed:', err.message);
  } finally {
    console.log('📱 [Appium] Closing driver session...');
    await driver.deleteSession();
  }

  console.log('\n--- FINAL MOBILE COUPON VERIFICATION ---');
  console.table(couponStatus);
}

// Run Main Flow
(async () => {
  const port = 4725;
  try {
    // 1. Start Appium Server (or reuse existing one)
    await startAppiumServer(port);

    // 2. Scrape coupons
    const coupons = await scrapeCoupons();

    // 3. Test on Mobile
    await testCouponsOnMobile(coupons);
  } catch (error) {
    console.error('Fatal execution error:', error);
  } finally {
    // 4. Gracefully shutdown Appium server if we started it
    stopAppiumServer();
  }
})();
