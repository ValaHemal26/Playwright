'use strict';

/**
 * ============================================================================
 * TEST SUITE ID   : TC_DOMINOS_ANDROID_E2E_001
 * TEST SUITE NAME : Domino's Android End-to-End Cart & Coupon Automation Suite
 * FRAMEWORK       : Appium (UiAutomator2) + WebdriverIO + Playwright + Node.js
 * AUTHOR          : QA Automation Engineering Team
 * ============================================================================
 */

const { remote } = require('webdriverio');
const { chromium } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

/* ============================================================================
 * 1. CONFIGURATION & ENVIRONMENT VARIABLES (SYNCHRONIZED WITH DASHBOARD)
 * ============================================================================ */

const PORT = Number(process.env.APPIUM_PORT || 4725);
const APP_PACKAGE = process.env.APP_PACKAGE || 'com.Dominos';
const APP_ACTIVITY = process.env.APP_ACTIVITY || 'com.Dominos.activity.alias.LauncherDefaultAlias';

const MIN_CART_VALUE = Number(process.env.MIN_CART_VALUE || 400);
const COUPON_SOURCE = process.env.COUPON_SOURCE || 'wethrift';
const COUPONS_JSON_PATH = path.join(__dirname, 'coupons.json');

const CATEGORY_PRIORITY = [
  'Pizza Mania',
  'Veg Pizza',
  'Bestsellers',
  'No Onion No Garlic',
  'Recommended'
];

let appiumProcess = null;
let spawnedAppium = false;

/* ============================================================================
 * 2. SYSTEM HELPERS & UTILITIES
 * ============================================================================ */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseMoney(text) {
  if (!text) return null;
  const normalized = String(text).replace(/,/g, '').replace(/₹/g, '').trim();
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function escapeUiSelectorText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* ============================================================================
 * 3. ANDROID SDK & APPIUM SERVER LIFECYCLE
 * ============================================================================ */

function configureAndroidSdk() {
  const detectedSdk = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
    : 'C:\\Users\\Hemal\\AppData\\Local\\Android\\Sdk';

  if (!process.env.ANDROID_HOME || !fs.existsSync(process.env.ANDROID_HOME)) {
    process.env.ANDROID_HOME = detectedSdk;
  }
  if (!process.env.ANDROID_SDK_ROOT || !fs.existsSync(process.env.ANDROID_SDK_ROOT)) {
    process.env.ANDROID_SDK_ROOT = detectedSdk;
  }

  const platformTools = path.join(detectedSdk, 'platform-tools');
  if (fs.existsSync(platformTools) && !process.env.PATH.includes(platformTools)) {
    process.env.PATH = `${platformTools};${process.env.PATH}`;
  }

  return detectedSdk;
}

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
          reject(new Error(`Timeout waiting for Appium port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });
      socket.on('timeout', () => {
        socket.destroy();
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`Timeout waiting for Appium port ${port}`));
        } else {
          setTimeout(check, 500);
        }
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}

async function startAppiumServer(port = 4725) {
  const androidHome = configureAndroidSdk();

  // If port is in use, clean up old zombie process to guarantee clean SDK environment
  const inUse = await isPortInUse(port);
  if (inUse) {
    try {
      const netstat = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      for (const line of netstat.split('\n')) {
        if (line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0') {
            console.log(`🧹 [Appium] Cleaning up old process on port ${port} (PID ${pid})...`);
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            await delay(1500);
          }
        }
      }
    } catch (_) {}
  }

  console.log(`\n🚀 [Appium] Starting Appium server programmatically on port ${port} (SDK: ${androidHome})...`);
  spawnedAppium = true;

  const platformTools = path.join(androidHome, 'platform-tools');
  const pathWithAdb = `${platformTools};${process.env.PATH}`;

  appiumProcess = spawn('npx', ['appium', '--port', String(port), '--allow-cors'], {
    env: {
      ...process.env,
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
      PATH: pathWithAdb
    },
    cwd: __dirname,
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

function stopAppiumServer() {
  if (appiumProcess && spawnedAppium) {
    console.log('\n🛑 [Appium] Stopping programmatically spawned Appium server...');
    try {
      appiumProcess.kill('SIGINT');
    } catch (_) {}
  }
}

/* ============================================================================
 * 4. ADB DEVICE CONNECTION & CAPABILITIES
 * ============================================================================ */

function getAdbPath() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const adb = sdk
    ? path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    : 'adb';
  return fs.existsSync(adb) ? `"${adb}"` : 'adb';
}

function adb(command) {
  return execSync(`${getAdbPath()} ${command}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function getOnlineUdid() {
  if (process.env.TARGET_UDID && process.env.TARGET_UDID.trim()) {
    const target = process.env.TARGET_UDID.trim();
    if (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(target)) {
      try {
        console.log(`📡 [ADB] Connecting to wireless target: ${target}...`);
        adb(`connect ${target}`);
      } catch (_) {}
    }

    try {
      const output = adb('devices');
      if (output.split('\n').some(line => line.startsWith(target + '\tdevice'))) {
        return target;
      }
    } catch (_) {}
    return target;
  }

  try {
    const output = adb('devices');
    const devices = output
      .split('\n')
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0].trim())
      .filter(Boolean);

    const ipDevice = devices.find(d => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(d));
    return ipDevice || devices[0];
  } catch (_) {
    return undefined;
  }
}

/* ============================================================================
 * 5. DYNAMIC COUPON SOURCING (JSON CACHE OR PLAYWRIGHT SCRAPING)
 * ============================================================================ */

async function scrapeCoupons() {
  if (process.env.CUSTOM_COUPONS) {
    const list = process.env.CUSTOM_COUPONS.split(',').map(c => c.trim()).filter(Boolean);
    if (list.length > 0) {
      console.log(`⚡ [Coupons] Loaded ${list.length} custom user-provided coupons from Dashboard: ${list.join(', ')}`);
      return list;
    }
  }

  const couponSource = process.env.COUPON_SOURCE || 'wethrift';
  const jsonPath = path.join(__dirname, 'coupons.json');

  if (process.env.FORCE_SCRAPE !== 'true' && fs.existsSync(jsonPath)) {
    try {
      const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      let cachedData = [];
      if (Array.isArray(rawData)) {
        cachedData = rawData;
      } else if (typeof rawData === 'object' && rawData !== null) {
        cachedData = rawData[couponSource] || rawData.wethrift || rawData.grabon || [];
      }
      if (cachedData.length > 0) {
        console.log(`⚡ [Coupons] Loaded ${cachedData.length} coupons directly from local file (coupons.json) for source '${couponSource}'.`);
        return cachedData;
      }
    } catch (_) {}
  }

  console.log(`🌐 [Playwright] Launching browser to scrape coupons from ${couponSource}...`);
  let coupons = [];
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    if (couponSource === 'grabon') {
      console.log('🌐 [Playwright] Navigating to grabon.in/dominos-coupons/...');
      await page.goto('https://www.grabon.in/dominos-coupons/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(2000);

      const cards = page.locator('.gcbr, [id^="cpn_"]');
      const count = await cards.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const codeElements = card.locator('[data-code], [data-inner-text], [data-clip]');
        const elCount = await codeElements.count().catch(() => 0);
        for (let j = 0; j < elCount; j++) {
          const el = codeElements.nth(j);
          const val = await el.getAttribute('data-code').catch(() => null) ||
            await el.getAttribute('data-inner-text').catch(() => null) ||
            await el.getAttribute('data-clip').catch(() => null);

          if (val && val.trim() && !/Unlock|Show|Deal|Redeem|Offer/i.test(val)) {
            const code = val.trim();
            if (!coupons.includes(code)) coupons.push(code);
          }
        }
      }
    } else {
      console.log('🌐 [Playwright] Navigating to wethrift.com/dominos-pizza-india...');
      await page.goto('https://www.wethrift.com/dominos-pizza-india', { waitUntil: 'commit', timeout: 30000 });
      await delay(2000);

      const [newPage] = await Promise.all([
        page.context().waitForEvent('page').catch(() => null),
        page.getByRole('button', { name: 'Show Code' }).first().click().catch(() => null)
      ]);

      const targetPage = newPage || page;
      await targetPage.waitForLoadState('domcontentloaded').catch(() => null);
      await delay(1500);

      coupons = await targetPage.evaluate(() => {
        const copyButtons = Array.from(document.querySelectorAll('button')).filter(btn => btn.textContent?.trim() === 'Copy');
        return copyButtons.map(btn => {
          const wrapper = btn.parentElement;
          if (!wrapper) return '';
          const textContainer = wrapper.querySelector('div, span');
          return textContainer ? textContainer.textContent?.trim() || '' : '';
        }).filter(code => code.length > 0 && code !== 'Copy');
      });

      if (newPage) await newPage.close().catch(() => {});
    }

    console.log(`🎉 [Playwright] Extracted ${coupons.length} coupons from ${couponSource}.`);

    if (coupons.length > 0) {
      let existing = { wethrift: [], grabon: [] };
      if (fs.existsSync(jsonPath)) {
        try { existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch (_) {}
      }
      existing[couponSource] = coupons;
      fs.writeFileSync(jsonPath, JSON.stringify(existing, null, 2));
      console.log(`💾 [Coupons] Saved ${coupons.length} scraped coupons to coupons.json`);
    }
  } catch (error) {
    console.error('❌ [Playwright] Error while scraping:', error.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (!coupons || coupons.length === 0) {
    coupons = ['BNGE2211', 'YUM3500', 'LIT1764', 'LIT2120', 'pizza100', 'grabe1764'];
  }

  return coupons;
}

/* ============================================================================
 * 6. FAST NON-BLOCKING UI AUTOMATION HELPERS
 * ============================================================================ */

async function dismissPopups(driver) {
  const popupSelectors = [
    // Google Play Services Location Accuracy Prompt -> Strictly Click "No, thanks"
    { selector: 'android=new UiSelector().text("No, thanks")', desc: 'Click "No, thanks" (Reject Location)' },
    { selector: 'android=new UiSelector().text("No thanks")', desc: 'Click "No thanks" (Reject Location)' },
    { selector: 'android=new UiSelector().text("NO THANKS")', desc: 'Click "NO THANKS" (Reject Location)' },
    { selector: 'android=new UiSelector().textContains("No, thanks")', desc: 'Click "No, thanks"' },
    { selector: 'android=new UiSelector().textContains("No thanks")', desc: 'Click "No thanks"' },
    { selector: 'android=new UiSelector().resourceId("com.google.android.gms:id/negative_button")', desc: 'GMS "No thanks" Button' },
    { selector: 'android=new UiSelector().resourceId("android:id/button2")', desc: 'System Dialog "No thanks" Button' },

    // Android Runtime Permissions -> Deny / While Using App fallback
    { selector: 'android=new UiSelector().text("Don\'t allow")', desc: 'Runtime Permission - Don\'t allow' },
    { selector: 'android=new UiSelector().text("Deny")', desc: 'Runtime Permission - Deny' },
    { selector: 'android=new UiSelector().text("Only this time")', desc: 'Runtime Permission - Only this time' },
    { selector: 'android=new UiSelector().text("While using the app")', desc: 'Runtime Permission - While using app' },

    // Domino's In-App Popups & Promos
    { selector: 'android=new UiSelector().resourceId("com.Dominos:id/tv_cta")', desc: 'Allow Location CTA' },
    { selector: 'android=new UiSelector().text("Yay! Thanks")', desc: 'Yay Thanks Free Delivery Popup' },
    { selector: 'android=new UiSelector().text("OK")', desc: 'OK Alert Dismiss' },
    { selector: 'android=new UiSelector().text("Ok")', desc: 'Ok Alert Dismiss' },
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
          await delay(800);
        }
      }
    } catch (_) {}
  }
}

// Fast Non-Blocking Helper: Click first matching element if visible without hanging
const clickFast = async (driver, selectors, desc) => {
  for (const sel of selectors) {
    try {
      const els = await driver.$$(sel);
      if (els && els.length > 0) {
        for (const el of els) {
          if (await el.isDisplayed().catch(() => false)) {
            try {
              await el.click();
              console.log(`📱 [Appium] Tapped: ${desc}`);
              await delay(1200);
              return true;
            } catch (_) {
              // Try parent container click
              try {
                const parent = await el.$('..');
                if (parent) {
                  await parent.click();
                  console.log(`📱 [Appium] Tapped parent container: ${desc}`);
                  await delay(1200);
                  return true;
                }
              } catch (_) {}

              // Coordinate tap fallback
              try {
                const loc = await el.getLocation();
                const size = await el.getSize();
                const centerX = Math.floor(loc.x + size.width / 2);
                const centerY = Math.floor(loc.y + size.height / 2);
                await driver.performActions([{
                  type: 'pointer',
                  id: 'finger1',
                  parameters: { pointerType: 'touch' },
                  actions: [
                    { type: 'pointerMove', duration: 0, x: centerX, y: centerY },
                    { type: 'pointerDown', button: 0 },
                    { type: 'pause', duration: 100 },
                    { type: 'pointerUp', button: 0 }
                  ]
                }]);
                console.log(`📱 [Appium] Performed coordinate tap at (${centerX}, ${centerY}) for: ${desc}`);
                await delay(1200);
                return true;
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
  return false;
};

const scrollDownOnce = async (driver) => {
  try {
    const size = await driver.getWindowSize();
    const startX = Math.floor(size.width * 0.5);
    const startY = Math.floor(size.height * 0.75);
    const endY = Math.floor(size.height * 0.28);
    await driver.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 600, x: startX, y: endY },
        { type: 'pointerUp', button: 0 }
      ]
    }]);
    await delay(800);
  } catch (_) {
    try {
      const sel = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollForward()`;
      await driver.$(sel);
      await delay(800);
    } catch (_) {}
  }
};

const scrollHorizontalOnce = async (driver, direction = 'left') => {
  try {
    const size = await driver.getWindowSize();
    const startY = Math.floor(size.height * 0.22); // Top tab bar area
    const startX = direction === 'left' ? Math.floor(size.width * 0.82) : Math.floor(size.width * 0.18);
    const endX = direction === 'left' ? Math.floor(size.width * 0.18) : Math.floor(size.width * 0.82);
    await driver.performActions([{
      type: 'pointer',
      id: 'finger1',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x: startX, y: startY },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 500, x: endX, y: startY },
        { type: 'pointerUp', button: 0 }
      ]
    }]);
    await delay(800);
  } catch (_) {}
};

const scrollHorizontalToText = async (driver, text) => {
  const escaped = escapeUiSelectorText(text);
  const directEl = await driver.$$(`android=new UiSelector().textContains("${escaped}")`).catch(() => []);
  if (directEl.length > 0 && await directEl[0].isDisplayed().catch(() => false)) {
    return true;
  }

  // Perform quick horizontal swipes to find tab
  for (let swipe = 0; swipe < 3; swipe++) {
    await scrollHorizontalOnce(driver, 'left');
    const el = await driver.$$(`android=new UiSelector().textContains("${escaped}")`).catch(() => []);
    if (el.length > 0 && await el[0].isDisplayed().catch(() => false)) {
      return true;
    }
  }
  return false;
};

/* ============================================================================
 * 7. CART MANAGEMENT & CATEGORY SELECTION WITH RESILIENT FALLBACKS
 * ============================================================================ */

const navigateToMenuScreen = async (driver) => {
  console.log('📱 [Appium] Checking if on Domino\'s Home screen and navigating to Menu...');
  await dismissPopups(driver);

  // Look for Bottom Nav "Menu" tab, Delivery, or Explore Menu buttons
  const enteredMenu = await clickFast(driver, [
    'android=new UiSelector().text("Menu")',
    'android=new UiSelector().description("Menu")',
    'android=new UiSelector().textContains("Explore Menu")',
    'android=new UiSelector().textContains("EXPLORE MENU")',
    'android=new UiSelector().textContains("Order Now")',
    'android=new UiSelector().textContains("ORDER NOW")',
    'android=new UiSelector().text("Delivery")',
    'android=new UiSelector().text("DELIVERY")',
    'android=new UiSelector().textContains("Everyday Value")',
    'android=new UiSelector().resourceId("com.Dominos:id/btn_delivery")',
    'android=new UiSelector().resourceId("com.Dominos:id/ll_delivery")',
  ], 'Bottom Nav "Menu" / Explore Menu / Delivery Entry');

  if (enteredMenu) {
    await delay(1800);
    await dismissPopups(driver);
  }

  // Scroll down slightly to ensure menu cards and category tabs are in active viewport
  console.log('📱 [Appium] Performing initial vertical scroll to reveal categories...');
  await scrollDownOnce(driver);
  await delay(800);
  await dismissPopups(driver);
};

const goBackToMenu = async (driver) => {
  console.log('📱 [Appium] Navigating back to Menu...');
  const backClicked = await clickFast(driver, [
    'android=new UiSelector().resourceId("com.Dominos:id/ivBack")',
    'android=new UiSelector().resourceId("com.Dominos:id/iv_back")',
    'android=new UiSelector().description("Back")',
    'android=new UiSelector().description("Navigate up")',
  ], 'Back Button');
  if (!backClicked) {
    await driver.back().catch(() => null);
  }
  await delay(1500);
  await dismissPopups(driver);
};

const goToCartScreen = async (driver) => {
  console.log('🛒 [Appium] Navigating to Cart Screen...');
  let opened = await clickFast(driver, [
    'android=new UiSelector().textContains("View Cart")',
    'android=new UiSelector().resourceId("com.Dominos:id/btn_view_cart")',
    'android=new UiSelector().resourceId("com.Dominos:id/tv_cart_item_count")',
    'android=new UiSelector().resourceId("com.Dominos:id/ll_cart_view")',
    'android=new UiSelector().text("Cart")',
    '//*[@content-desc="Cart"]',
  ], 'View Cart Floating Bar / Cart Tab');

  if (opened) {
    await delay(1500);
    await dismissPopups(driver);
    return true;
  }

  opened = await clickFast(driver, [
    'android=new UiSelector().resourceId("com.Dominos:id/ivCart")',
    'android=new UiSelector().resourceId("com.Dominos:id/iv_cart")',
  ], 'Cart Icon');

  if (opened) {
    await delay(1500);
    await dismissPopups(driver);
    return true;
  }

  return false;
};

const getCartSubtotal = async (driver) => {
  const possibleSelectors = [
    'android=new UiSelector().textContains("Subtotal")',
    'android=new UiSelector().textContains("Item Value")',
    'android=new UiSelector().textContains("Item Total")',
    'android=new UiSelector().resourceId("com.Dominos:id/tvSubtotal")',
    'android=new UiSelector().resourceId("com.Dominos:id/tv_subtotal")',
    'android=new UiSelector().resourceId("com.Dominos:id/tvSubTotal")',
    'android=new UiSelector().resourceId("com.Dominos:id/tv_cart_price")',
  ];

  for (const sel of possibleSelectors) {
    try {
      const els = await driver.$$(sel);
      for (const el of els) {
        if (await el.isDisplayed().catch(() => false)) {
          const text = await el.getText().catch(() => '');
          const val = parseMoney(text);
          if (val !== null && val > 0) {
            console.log(`🛒 [Appium] Parsed cart subtotal: ₹${val}`);
            return val;
          }
        }
      }
    } catch (_) {}
  }

  // Fallback: Check floating bottom bar
  const cartBarEls = await driver.$$('android=new UiSelector().textContains("Item")').catch(() => []);
  for (const el of cartBarEls) {
    if (await el.isDisplayed().catch(() => false)) {
      const text = await el.getText().catch(() => '');
      const val = parseMoney(text);
      if (val !== null && val > 0) {
        console.log(`🛒 [Appium] Parsed subtotal from View Cart bar: ₹${val}`);
        return val;
      }
    }
  }

  return 0;
};

const selectCategory = async (driver, preferredCategory = 'Pizza Mania') => {
  const queue = [preferredCategory, ...CATEGORY_PRIORITY.filter(c => c !== preferredCategory)];

  for (const category of queue) {
    const escaped = escapeUiSelectorText(category);
    const selectors = [
      `android=new UiSelector().text("${escaped}")`,
      `android=new UiSelector().textContains("${escaped}")`,
      `android=new UiSelector().resourceId("com.Dominos:id/tvCategory").text("${escaped}")`
    ];

    let found = await clickFast(driver, selectors, `Category "${category}"`);
    if (!found) {
      // Try vertical scroll once if categories are presented as cards on feed
      await scrollDownOnce(driver);
      found = await clickFast(driver, selectors, `Category "${category}" (post vertical-scroll)`);
    }

    if (!found) {
      found = await scrollHorizontalToText(driver, category);
      if (found) {
        found = await clickFast(driver, selectors, `Category "${category}" (post horizontal-scroll)`);
      }
    }

    if (found) {
      console.log(`🎯 [Category] Switched to: "${category}"`);
      await delay(1200);
      await dismissPopups(driver);
      return category;
    }
  }
  return 'Active Category View';
};

const ensureCartHasMinSubtotal = async (driver, targetValue) => {
  // Enforce a 15% safety buffer above minimum target (e.g. ₹400 -> ₹460) to guarantee MOV eligibility
  const targetThreshold = Math.ceil(targetValue * 1.15);
  console.log(`\n🛒 [Appium] Target Cart Total: ₹${targetThreshold} (Base ₹${targetValue} + 15% safety buffer for coupon MOV)`);

  // Step 1: Ensure we are inside the Menu / Catalog view
  await navigateToMenuScreen(driver);

  // Step 2: Check current subtotal (in case cart already has items)
  let currentSubtotal = await getCartSubtotal(driver);
  console.log(`🛒 [Appium] Initial Cart Subtotal: ₹${currentSubtotal}`);

  if (currentSubtotal >= targetThreshold) {
    console.log(`✅ [Appium] Cart already has ₹${currentSubtotal} (>= required ₹${targetThreshold}). Ready for coupon testing.`);
    return true;
  }

  // Step 3: Select initial category
  await selectCategory(driver, 'Pizza Mania');

  let attempts = 0;
  const maxAttempts = 10;
  const categoriesToTry = ['Pizza Mania', 'Veg Pizza', 'Bestsellers', 'No Onion No Garlic'];
  let catIndex = 0;

  while (currentSubtotal < targetThreshold && attempts < maxAttempts) {
    attempts++;
    console.log(`🍕 [Appium] Adding Item #${attempts} (Current: ₹${currentSubtotal} / Target: ₹${targetThreshold})...`);

    // 1. Locate all visible ADD buttons on current screen
    let addBtns = await driver.$$('android=new UiSelector().text("ADD")').catch(() => []);
    if (addBtns.length === 0) {
      addBtns = await driver.$$('android=new UiSelector().text("Add +")').catch(() => []);
    }
    if (addBtns.length === 0) {
      addBtns = await driver.$$('android=new UiSelector().textContains("ADD")').catch(() => []);
    }
    if (addBtns.length === 0) {
      addBtns = await driver.$$('android=new UiSelector().resourceId("com.Dominos:id/btn_add_to_cart")').catch(() => []);
    }
    if (addBtns.length === 0) {
      addBtns = await driver.$$('android=new UiSelector().resourceId("com.Dominos:id/btnAdd")').catch(() => []);
    }

    let addedItem = false;

    // 2. Click first clickable ADD button
    if (addBtns.length > 0) {
      for (const btn of addBtns) {
        if (await btn.isDisplayed().catch(() => false)) {
          console.log('🍕 [Appium] Tapping "ADD" on pizza card...');
          try {
            await btn.click();
          } catch (_) {
            const loc = await btn.getLocation().catch(() => null);
            const sz = await btn.getSize().catch(() => null);
            if (loc && sz) {
              await driver.performActions([{
                type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' },
                actions: [
                  { type: 'pointerMove', duration: 0, x: Math.floor(loc.x + sz.width / 2), y: Math.floor(loc.y + sz.height / 2) },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pause', duration: 100 },
                  { type: 'pointerUp', button: 0 }
                ]
              }]).catch(() => null);
            }
          }

          addedItem = true;
          await delay(1500);

          // 3. Handle Customization / Crust / Size Modal if it pops up
          await clickFast(driver, [
            'android=new UiSelector().text("Add +")',
            'android=new UiSelector().resourceId("com.Dominos:id/btn_add_customization")',
            'android=new UiSelector().textContains("ADD ITEM")',
            'android=new UiSelector().textContains("Add")',
            'android=new UiSelector().textContains("CONTINUE")',
            'android=new UiSelector().text("Continue")',
            'android=new UiSelector().resourceId("com.Dominos:id/btn_add")',
          ], 'Customization Modal Add Button');

          await delay(1000);
          await dismissPopups(driver);
          break;
        }
      }
    }

    // 4. If no buttons were clickable on current viewport, scroll down
    if (!addedItem) {
      console.log('🍕 [Appium] Scrolling down to find more pizza items...');
      await scrollDownOnce(driver);
      await delay(1000);
    }

    // 5. Read updated subtotal from the floating "View Cart" bar
    const parsedBarTotal = await getCartSubtotal(driver);
    if (parsedBarTotal > 0) {
      currentSubtotal = parsedBarTotal;
      console.log(`🛒 [Appium] Updated Cart Subtotal: ₹${currentSubtotal}`);
    } else {
      // Estimated increment if bar text not parsed
      currentSubtotal += 129;
      console.log(`🛒 [Appium] Estimated Cart Subtotal: ~₹${currentSubtotal}`);
    }

    // 6. Check if target threshold is achieved
    if (currentSubtotal >= targetThreshold) {
      console.log(`🎯 [Appium] Reached required cart threshold (₹${currentSubtotal} >= ₹${targetThreshold})!`);
      break;
    }

    // 7. If still below target after 2 additions in this category, switch to next category
    if (attempts % 2 === 0 && catIndex < categoriesToTry.length - 1) {
      catIndex++;
      console.log(`🔄 [Category] Switching to next category: "${categoriesToTry[catIndex]}" to add variety...`);
      await selectCategory(driver, categoriesToTry[catIndex]);
      await delay(1200);
    } else {
      await scrollDownOnce(driver);
    }
  }

  // Step 4: Open Cart Screen and perform final total verification
  console.log('\n🛒 [Appium] Opening Cart Screen to confirm items & bill breakdown...');
  const openedCart = await goToCartScreen(driver);
  if (openedCart) {
    const verifiedTotal = await getCartSubtotal(driver);
    if (verifiedTotal > 0) currentSubtotal = verifiedTotal;
    console.log(`✅ [Appium] Verified Final Cart Subtotal on Cart Screen: ₹${currentSubtotal}`);
  }

  console.log(`🚀 [Appium] Cart is ready with ₹${currentSubtotal}. Transitioning to Coupon Testing Phase!`);
  return currentSubtotal >= targetValue;
};

const goToCouponsFromCart = async (driver) => {
  const inputs = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
  if (inputs.length > 0 && await inputs[0].isDisplayed().catch(() => false)) {
    return true;
  }

  const clickedOffers = await clickFast(driver, [
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

/* ============================================================================
 * 8. MAIN APPIUM COUPON TESTING ENGINE
 * ============================================================================ */

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
    'appium:noReset': true,
    'appium:dontStopAppOnReset': true,
    'appium:newCommandTimeout': 300,
    'appium:ignoreHiddenApiPolicyError': true,
    'appium:adbExecTimeout': 60000,
    'appium:uiautomator2ServerLaunchTimeout': 60000,
    'appium:settings[implicitWaitTimeout]': 0,
    'appium:settings[waitForIdleTimeout]': 0,
  };

  const driver = await remote({
    hostname: '127.0.0.1',
    port: PORT,
    path: '/',
    capabilities,
  });

  // Zero out server-side implicit wait to eliminate delays on missing selectors
  try {
    await driver.updateSettings({ implicitWaitTimeout: 0, waitForIdleTimeout: 0 }).catch(() => null);
  } catch (_) {}

  try {
    await driver.setTimeouts({ implicit: 0 });
  } catch (_) {
    try { await driver.setTimeout({ implicit: 0 }); } catch (_) {}
  }

  const couponStatus = [];

  try {
    console.log('📱 [Appium] Dominos app connected successfully.');
    console.log('📱 [Appium] Bringing Dominos app to foreground...');
    await driver.activateApp(APP_PACKAGE).catch(() => null);
    await delay(2000);
    await dismissPopups(driver);

    // STEP 1: Ensure cart has the required minimum subtotal
    await ensureCartHasMinSubtotal(driver, MIN_CART_VALUE);

    // STEP 2: Navigate to Coupons view
    await goToCouponsFromCart(driver);

    console.log(`\n🎟️ [Appium] Starting dynamic coupon verification loop (${coupons.length} coupons)...`);

    // STEP 3: Iterate and test all coupons
    for (const coupon of coupons) {
      try {
        console.log(`\n------------------------------------------------------------`);
        console.log(`🎫 Testing Coupon: "${coupon}"`);
        console.log(`------------------------------------------------------------`);

        await goToCouponsFromCart(driver);

        // 1. Locate Promo Code Input Field
        let promoInputEls = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
        if (promoInputEls.length === 0 || !(await promoInputEls[0].isDisplayed().catch(() => false))) {
          console.log('⚠️ [Appium] Coupons input field not found on screen. Re-navigating...');
          await goToCouponsFromCart(driver);
          promoInputEls = await driver.$$('android=new UiSelector().className("android.widget.EditText")').catch(() => []);
        }

        if (promoInputEls.length === 0) {
          throw new Error('Coupons input field (EditText) not found on Offers/Coupons page.');
        }

        const promoInput = promoInputEls[0];

        // Clear & fill coupon code
        await promoInput.clearValue().catch(() => null);
        await promoInput.setValue(coupon);
        console.log(`📱 [Appium] Entered coupon code: ${coupon}`);

        try { await driver.hideKeyboard(); } catch (_) {}

        // 2. Click Apply button
        await clickFast(driver, [
          'android=new UiSelector().text("Apply")',
          'android=new UiSelector().text("APPLY")',
          'android=new UiSelector().resourceId("com.Dominos:id/btn_apply")',
          'android=new UiSelector().resourceId("com.Dominos:id/apply_coupon_btn")',
        ], 'Apply Button');

        await delay(2500);

        // 3. Determine Result (Success vs Failure)
        let status = 'FAILED';
        let details = 'Coupon invalid or not eligible';
        let discount = 0;

        // Check for Success overlay ("Yay! Thanks" or "Applied" banner)
        const yayBtns = await driver.$$('android=new UiSelector().text("Yay! Thanks")').catch(() => []);
        const savedEls = await driver.$$('android=new UiSelector().textContains("saved")').catch(() => []);
        const appliedEls = await driver.$$('android=new UiSelector().textContains("Applied")').catch(() => []);

        const isSuccess = (yayBtns.length > 0 && await yayBtns[0].isDisplayed().catch(() => false)) ||
                          (savedEls.length > 0 && await savedEls[0].isDisplayed().catch(() => false)) ||
                          (appliedEls.length > 0 && await appliedEls[0].isDisplayed().catch(() => false));

        if (isSuccess) {
          status = 'SUCCESS';

          if (savedEls.length > 0) {
            const text = await savedEls[0].getText().catch(() => '');
            details = text || 'Coupon Applied Successfully';
            const parsed = parseMoney(text);
            if (parsed) discount = parsed;
          } else {
            details = 'Coupon Applied Successfully';
          }

          console.log(`🎉 [Appium] Coupon SUCCESS: ${details} (Discount: ₹${discount})`);
          couponStatus.push({ coupon, status, discount, details });

          // Inspect Bill Details if valid
          await clickFast(driver, [
            'android=new UiSelector().text("View Details")',
            'android=new UiSelector().resourceId("com.Dominos:id/tv_view_details")'
          ], 'View Details');
          await delay(1200);
          await clickFast(driver, [
            'android=new UiSelector().resourceId("com.Dominos:id/iv_close")',
            'android=new UiSelector().text("X")'
          ], 'Close Bill Details');

          // Dismiss success modal if visible
          if (yayBtns.length > 0 && await yayBtns[0].isDisplayed().catch(() => false)) {
            await yayBtns[0].click().catch(() => null);
            await delay(1500);
          }

          // Remove applied coupon to prepare for next test
          console.log('📱 [Appium] Removing applied coupon to prepare for next test...');
          const removed = await clickFast(driver, [
            'android=new UiSelector().text("Remove")',
            'android=new UiSelector().text("REMOVE")',
            'android=new UiSelector().resourceId("com.Dominos:id/tv_remove")',
            'android=new UiSelector().resourceId("com.Dominos:id/remove_coupon")',
          ], 'Remove Coupon Link');

          if (removed) {
            await delay(1500);
          }
        } else {
          // Check for Error message
          const errEls = await driver.$$('android=new UiSelector().textContains("Something went wrong")').catch(() => []);
          const invalidEls = await driver.$$('android=new UiSelector().textContains("invalid")').catch(() => []);
          const notEligibleEls = await driver.$$('android=new UiSelector().textContains("not applicable")').catch(() => []);

          if (errEls.length > 0 && await errEls[0].isDisplayed().catch(() => false)) {
            details = await errEls[0].getText().catch(() => 'Something went wrong. Please try again.');
          } else if (invalidEls.length > 0 && await invalidEls[0].isDisplayed().catch(() => false)) {
            details = await invalidEls[0].getText().catch(() => 'Coupon Code is invalid or expired');
          } else if (notEligibleEls.length > 0 && await notEligibleEls[0].isDisplayed().catch(() => false)) {
            details = await notEligibleEls[0].getText().catch(() => 'Coupon not applicable on this cart value');
          }

          console.log(`❌ [Appium] Coupon FAILED: ${details}`);
          couponStatus.push({ coupon, status, discount, details });

          // Dismiss error button if present
          await clickFast(driver, ['android=new UiSelector().text("OK")', 'android=new UiSelector().text("Ok")'], 'OK Error Dismiss Button');

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
    console.error('❌ [Appium] Automation flow error:', err.message);
  } finally {
    console.log('📱 [Appium] Closing driver session...');
    await driver.deleteSession().catch(() => null);
  }

  console.log('\n============================================================');
  console.log('📊 FINAL MOBILE COUPON VERIFICATION SUMMARY TABLE');
  console.log('============================================================');
  console.table(couponStatus.map(r => ({
    'Coupon Code': r.coupon,
    'Status': r.status === 'SUCCESS' ? '✅ SUCCESS' : (r.status === 'FAILED' ? '❌ FAILED' : '⚠️ ERROR'),
    'Discount (₹)': r.discount ? `₹${r.discount}` : '₹0',
    'Details': r.details
  })));
}

/* ============================================================================
 * 9. SCRIPT ENTRY POINT
 * ============================================================================ */

(async () => {
  const port = PORT;
  try {
    // 1. Start Appium Server (or reuse existing one)
    await startAppiumServer(port);

    // 2. Scrape/Load coupons
    const coupons = await scrapeCoupons();

    // 3. Test on Mobile
    await testCouponsOnMobile(coupons);
    process.exitCode = 0;
  } catch (error) {
    console.error('💥 Fatal execution error:', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    // 4. Gracefully shutdown Appium server if spawned
    stopAppiumServer();
  }
})();