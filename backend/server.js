const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Ensure public/videos directory exists
const videosDir = path.join(__dirname, 'public', 'videos');
if (!fs.existsSync(videosDir)) {
  fs.mkdirSync(videosDir, { recursive: true });
}

// Serve public/videos folder statically
app.use('/videos', express.static(videosDir));

app.use(express.json());

// Enable CORS for cross-origin frontend requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serves a simple health check status at root
app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'scraper-backend', mode: 'socket-io-enabled' });
});

// ==========================================
// APPIUM DOMINOS AUTOMATION CONTROLLER
// ==========================================
let dominosProcess = null;
// Auto-configure Android SDK in PATH
const detectedSdk = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : 'C:\\Users\\Hemal\\AppData\\Local\\Android\\Sdk';
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

let dominosStatus = {
  running: false,
  logs: [],
  results: [],
  config: null
};

// Helper to get ADB command
function getAdbExecutable() {
  const adbExe = path.join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return fs.existsSync(adbExe) ? `"${adbExe}"` : 'adb';
}

// POST connect wireless ADB device
app.post('/api/devices/connect', (req, res) => {
  const { ip, port } = req.body || {};
  const target = req.body.target || (ip && port ? `${ip}:${port}` : ip);
  
  if (!target) {
    return res.status(400).json({ success: false, message: 'Target IP:PORT is required' });
  }

  try {
    const { execSync } = require('child_process');
    const adbCmd = getAdbExecutable();
    const output = execSync(`${adbCmd} connect ${target}`, { encoding: 'utf8', timeout: 10000 });
    console.log(`[ADB Connect] ${output.trim()}`);
    const connected = output.includes('connected') && !output.includes('cannot connect') && !output.includes('failed');
    
    res.json({
      success: connected,
      message: output.trim(),
      target
    });
  } catch (err) {
    res.json({
      success: false,
      message: err.message,
      target
    });
  }
});

// GET connected ADB devices & installed apps
app.get('/api/devices', (req, res) => {
  try {
    const { execSync } = require('child_process');
    const adbCmd = getAdbExecutable();

    let output = execSync(`${adbCmd} devices -l`, { encoding: 'utf8' });
    let lines = output.split('\n');
    let devices = [];

    for (const line of lines) {
      if (line.includes('\tdevice')) {
        const parts = line.trim().split(/\s+/);
        const udid = parts[0];
        let model = '';
        const modelMatch = line.match(/model:(\S+)/);
        if (modelMatch) {
          model = modelMatch[1].replace(/_/g, ' ');
        }
        devices.push({ udid, model, raw: line });
      }
    }

    // Check if any device is an mDNS auto-discovered handle without direct IP connection
    const mdnsDevice = devices.find(d => d.udid.startsWith('adb-'));
    const ipDevice = devices.find(d => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(d.udid));

    // Auto-connect IP if user provided or found in environment
    if (!ipDevice && mdnsDevice) {
      console.log(`[ADB] Found mDNS device ${mdnsDevice.udid}. Checking active connections...`);
    }

    // Format list of simple UDID strings for backward compatibility + detailed objects
    const deviceUdids = devices.map(d => d.udid);

    // Get third-party installed app packages for selected/first device
    let installedApps = [];
    const targetDevice = ipDevice ? ipDevice.udid : (devices[0] ? devices[0].udid : '');

    if (targetDevice) {
      try {
        const pkgOutput = execSync(`${adbCmd} -s "${targetDevice}" shell pm list packages -3`, { encoding: 'utf8', timeout: 5000 });
        const pkgs = pkgOutput.split('\n')
          .map(l => l.replace('package:', '').trim())
          .filter(Boolean);

        // Map popular/common packages to user friendly display names
        const knownApps = {
          'com.Dominos': "Domino's Pizza",
          'in.swiggy.android.toing': 'Swiggy',
          'com.application.zomato': 'Zomato',
          'com.zeptoconsumerapp': 'Zepto',
          'net.one97.paytm': 'Paytm',
          'com.phonepe.app': 'PhonePe',
          'com.rapido.passenger': 'Rapido',
          'com.app.uengage.lapinoz': "La Pino'z Pizza",
          'com.grocurystore.app': 'Blinkit',
          'com.whatsapp': 'WhatsApp',
          'com.instagram.android': 'Instagram',
          'org.telegram.messenger': 'Telegram',
          'in.startv.hotstar': 'Disney+ Hotstar',
          'com.nextbillion.groww': 'Groww',
          'in.upstox.app': 'Upstox',
          'com.ludo.king': 'Ludo King',
        };

        installedApps = pkgs.map(pkg => ({
          package: pkg,
          name: knownApps[pkg] || pkg
        })).sort((a, b) => a.name.localeCompare(b.name));
      } catch (e) {
        console.error('Error fetching installed packages:', e.message);
      }
    }

    res.json({
      success: true,
      devices: deviceUdids,
      deviceDetails: devices,
      installedApps
    });
  } catch (err) {
    res.json({ success: false, devices: [], installedApps: [], error: err.message });
  }
});

// POST start dominos appium automation
app.post('/api/dominos/start', (req, res) => {
  if (dominosStatus.running) {
    return res.status(400).json({ success: false, message: 'Automation test is already running!' });
  }

  const { udid, minCartValue, appPackage, appActivity, couponSource, customCoupons } = req.body || {};
  const { spawn } = require('child_process');

  dominosStatus = {
    running: true,
    logs: [],
    results: [],
    config: { udid, minCartValue, appPackage, appActivity, couponSource, customCoupons },
    startTime: new Date().toISOString()
  };

  io.emit('dominos:status', { type: 'started', status: dominosStatus });

  // If UDID looks like wireless IP:PORT, auto-connect via adb connect
  if (udid && (/^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(udid.trim()))) {
    try {
      const { execSync } = require('child_process');
      const adbCmd = getAdbExecutable();
      const connOutput = execSync(`${adbCmd} connect ${udid.trim()}`, { encoding: 'utf8', timeout: 8000 });
      console.log(`[Start Auto-Connect] ${connOutput.trim()}`);
    } catch (e) {
      console.warn(`[Start Auto-Connect Warning] ${e.message}`);
    }
  }

  const env = {
    ...process.env,
    ANDROID_HOME: process.env.ANDROID_HOME,
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT,
    PATH: `${path.join(process.env.ANDROID_HOME, 'platform-tools')};${process.env.PATH}`,
    TARGET_UDID: udid || '',
    MIN_CART_VALUE: String(minCartValue || 400),
    APP_PACKAGE: appPackage || 'com.Dominos',
    APP_ACTIVITY: appActivity || 'com.Dominos.activity.alias.LauncherDefaultAlias',
    COUPON_SOURCE: couponSource || 'wethrift',
    CUSTOM_COUPONS: Array.isArray(customCoupons) ? customCoupons.join(',') : (customCoupons || '')
  };

  dominosProcess = spawn('node', ['appium-dominos.js'], {
    cwd: __dirname,
    env,
    shell: true
  });

  const appendLog = (data, type = 'info') => {
    const text = data.toString();
    const logObj = { message: text, type, timestamp: new Date().toLocaleTimeString() };
    dominosStatus.logs.push(logObj);
    io.emit('dominos:log', logObj);
  };

  dominosProcess.stdout.on('data', (data) => appendLog(data, 'info'));
  dominosProcess.stderr.on('data', (data) => appendLog(data, 'error'));

  dominosProcess.on('close', (code) => {
    dominosStatus.running = false;
    dominosStatus.endTime = new Date().toISOString();
    dominosProcess = null;
    io.emit('dominos:status', { type: 'finished', exitCode: code, status: dominosStatus });
  });

  res.json({ success: true, message: 'Dominos automation started', config: dominosStatus.config });
});

// POST stop dominos automation
app.post('/api/dominos/stop', (req, res) => {
  if (!dominosStatus.running || !dominosProcess) {
    return res.json({ success: true, message: 'No automation test is currently running.' });
  }

  try {
    const pid = dominosProcess.pid;
    if (process.platform === 'win32' && pid) {
      const { exec } = require('child_process');
      exec(`taskkill /F /T /PID ${pid}`, (err) => {
        if (err) console.error('Taskkill error:', err.message);
      });
    } else {
      dominosProcess.kill('SIGKILL');
    }
    dominosStatus.running = false;
    dominosProcess = null;
    io.emit('dominos:status', { type: 'stopped', status: dominosStatus });
    res.json({ success: true, message: 'Automation test stopped successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET current status
app.get('/api/dominos/status', (req, res) => {
  res.json(dominosStatus);
});

// Helper for delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// ORACLE VM PROXIED QUEUE SYSTEM
// ==========================================
const queue = [];
let currentJob = null;

const ORACLE_VM_URL = process.env.ORACLE_VM_URL || 'http://localhost:4000';
const ORACLE_AUTH_TOKEN = process.env.ORACLE_AUTH_TOKEN || 'default_secure_token_change_me';

const updateQueuePositions = () => {
  queue.forEach((job, index) => {
    const s = io.sockets.sockets.get(job.socketId);
    if (s) {
      s.emit('status', {
        type: 'queued',
        message: `⏳ Request queued. Position: ${index + 1}/${queue.length}`
      });
    }
  });
};

const runJobOnOracle = (job, clientSocket) => {
  console.log(`🔗 Connecting to Oracle VM worker at: ${ORACLE_VM_URL}`);

  const oracleSocket = ioClient(ORACLE_VM_URL, {
    auth: {
      token: ORACLE_AUTH_TOKEN
    },
    reconnection: false,
    timeout: 10000
  });

  let completed = false;

  oracleSocket.on('connect', () => {
    console.log('✅ Connected to Oracle VM worker socket');
    clientSocket.emit('status', { type: 'running', message: '🚀 Connected to Oracle VM. Starting test run...' });

    // Send run-test to Oracle VM
    oracleSocket.emit('run-test', job.data);
  });

  oracleSocket.on('log', (logData) => {
    clientSocket.emit('log', logData);
  });

  oracleSocket.on('results', (resultsData) => {
    clientSocket.emit('results', resultsData);
  });

  oracleSocket.on('status', (statusData) => {
    clientSocket.emit('status', statusData);
    if (statusData.type === 'done' || statusData.type === 'error') {
      completed = true;
      oracleSocket.disconnect();
    }
  });

  oracleSocket.on('connect_error', (err) => {
    console.error('❌ Oracle VM Connection error:', err.message);
    oracleSocket.disconnect();
    handleOracleFailure(err);
  });

  oracleSocket.on('disconnect', () => {
    console.log('🔌 Disconnected from Oracle VM');
    if (!completed) {
      handleOracleFailure(new Error('Oracle VM disconnected unexpectedly.'));
    } else {
      finishJob();
    }
  });

  // Keep track of the active connection on the user's socket
  clientSocket.activeOracleSocket = oracleSocket;

  function handleOracleFailure(err) {
    if (job.retries < 3) {
      job.retries++;
      const delayMs = job.retries * 3000;
      clientSocket.emit('status', {
        type: 'running',
        message: `⚠️ Oracle VM unavailable (${err.message}). Retrying in ${delayMs / 1000}s... (Attempt ${job.retries}/3)`
      });
      setTimeout(() => {
        // Only retry if the client socket is still active
        if (io.sockets.sockets.has(job.socketId)) {
          runJobOnOracle(job, clientSocket);
        } else {
          finishJob();
        }
      }, delayMs);
    } else {
      clientSocket.emit('status', {
        type: 'error',
        message: `❌ Failed to connect to Oracle VM after 3 attempts: ${err.message}`
      });
      finishJob();
    }
  }

  function finishJob() {
    clientSocket.activeOracleSocket = null;
    currentJob = null;
    processQueue();
  }
};

const processQueue = () => {
  if (currentJob || queue.length === 0) return;

  currentJob = queue.shift();
  const clientSocket = io.sockets.sockets.get(currentJob.socketId);

  if (!clientSocket) {
    console.log(`Client socket ${currentJob.socketId} disconnected. Skipping job.`);
    currentJob = null;
    processQueue();
    return;
  }

  clientSocket.emit('status', { type: 'running', message: '⏳ Handshaking with Oracle Cloud VM...' });
  runJobOnOracle(currentJob, clientSocket);
  updateQueuePositions();
};

io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('run-test', (data) => {
    // Prevent duplicate entries from same socket
    const alreadyExists = queue.some(j => j.socketId === socket.id) || (currentJob && currentJob.socketId === socket.id);
    if (alreadyExists) {
      socket.emit('status', { type: 'running', message: '⚠️ A test request from you is already active or in the queue.' });
      return;
    }

    queue.push({
      id: Math.random().toString(36).substr(2, 9),
      socketId: socket.id,
      data: data,
      retries: 0
    });

    socket.emit('status', {
      type: 'queued',
      message: `⏳ Request queued. Position: ${queue.length}`
    });

    updateQueuePositions();
    processQueue();
  });

  socket.on('stop-test', () => {
    console.log(`🛑 Client requested stop: ${socket.id}`);

    if (currentJob && currentJob.socketId === socket.id) {
      if (socket.activeOracleSocket) {
        socket.activeOracleSocket.emit('stop-test');
        socket.activeOracleSocket.disconnect();
      }
      currentJob = null;
      socket.emit('status', { type: 'idle', message: '🛑 Test run stopped by user.' });
      processQueue();
    } else {
      const index = queue.findIndex(j => j.socketId === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
        socket.emit('status', { type: 'idle', message: '🛑 Test request removed from queue.' });
      }
    }
    updateQueuePositions();
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);

    if (currentJob && currentJob.socketId === socket.id) {
      if (socket.activeOracleSocket) {
        socket.activeOracleSocket.disconnect();
      }
      currentJob = null;
      processQueue();
    } else {
      const index = queue.findIndex(j => j.socketId === socket.id);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
    updateQueuePositions();
  });
});

// ==========================================
// FALLBACK/LOCAL SCRAPE ENDPOINT (SSE)
// ==========================================
app.get('/api/scrape', async (req, res) => {
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

    if (customCouponsInput.trim()) {
      coupons = customCouponsInput
        .split(/[\n,]/)
        .map(c => c.trim().toUpperCase())
        .filter(c => c.length > 0);
      sendLog(`📝 Using ${coupons.length} custom coupons. Skipping scraper.`, 'info');
    }

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
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          recordVideo: { dir: videosDir, size: { width: 1280, height: 720 } }
        });
        page = context.pages()[0] || await context.newPage();
      } else {
        browser = await chromium.connect({ wsEndpoint: wsUrl });
        context = await browser.newContext({
          viewport: { width: 1366, height: 768 },
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          recordVideo: { dir: videosDir, size: { width: 1280, height: 720 } }
        });
        page = await context.newPage();
      }
    } else if (process.env.VERCEL) {
      throw new Error("Running on Vercel requires a remote browser. Please set the BROWSER_WS_URL environment variable.");
    } else {
      const isCloud = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
      const actualHeadless = isCloud ? true : !headed;
      if (isCloud && headed) {
        sendLog('⚠️ Cloud container: forcing headless mode.', 'warning');
      }
      sendLog(isCloud ? '🚀 Launching headless cloud persistent context...' : '🚀 Launching local persistent context...', 'info');
      context = await chromium.launchPersistentContext('', {
        headless: actualHeadless,
        viewport: { width: 1366, height: 768 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        permissions: [],
        recordVideo: { dir: videosDir, size: { width: 1280, height: 720 } },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-web-security',
          '--window-size=1366,768',
          '--disable-popup-blocking',
          '--disable-notifications',
          '--deny-permission-prompts'
        ],
        ignoreDefaultArgs: ['--enable-automation']
      });
      page = await context.newPage();
    }

    await page.setViewportSize({ width: 1366, height: 768 }).catch(() => { });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      if (window.Notification) {
        window.Notification.requestPermission = () => Promise.resolve('denied');
        Object.defineProperty(window.Notification, 'permission', { get: () => 'denied' });
      }
    });

    const solveCloudflareIfNeeded = async (targetPage) => {
      const cloudflareIframe = targetPage.locator('iframe[src*="challenges.cloudflare.com"]').first();
      try {
        if (await cloudflareIframe.isVisible({ timeout: 4000 }).catch(() => false)) {
          sendLog('⚠️ Cloudflare detected! Solving...', 'warning');
          await delay(4000);
          const iframeBox = await cloudflareIframe.boundingBox();
          if (iframeBox) {
            await targetPage.mouse.move(iframeBox.x + 35, iframeBox.y + (iframeBox.height / 2), { steps: 15 });
            await delay(200);
            await targetPage.mouse.down();
            await delay(120);
            await targetPage.mouse.up();
            sendLog('✅ Clicked Turnstile.', 'success');
            await delay(4000);
          }
        }
      } catch (e) {
        sendLog(`Bypassed Cloudflare: ${e.message}`, 'info');
      }
    };

    if (coupons.length === 0) {
      if (site === 'wethrift') {
        sendLog("🌐 Navigating to Wethrift...", 'info');
        await page.goto("https://www.wethrift.com/dominos-pizza-india", { waitUntil: 'commit' });
        await delay(2000);
        await solveCloudflareIfNeeded(page);
        const [newPage] = await Promise.all([
          context.waitForEvent('page'),
          page.getByRole('button', { name: 'Show Code' }).first().click()
        ]);
        await newPage.waitForLoadState('domcontentloaded');
        await solveCloudflareIfNeeded(newPage);
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
        sendLog(`🎉 Scraped ${coupons.length} coupons from wethrift.com`, 'success', coupons);
        await newPage.close().catch(() => { });
      } else {
        sendLog('🌐 Navigating to grabon.in...', 'info');
        await page.goto("https://www.grabon.in/", { waitUntil: 'commit' });

        await page.waitForLoadState('domcontentloaded');
        await delay(1000);
        const searchInput = page.locator('input[placeholder="Search for brands, categories"]:visible').first();
        await searchInput.waitFor({ state: 'visible', timeout: 5000 });
        await searchInput.fill('dominos');
        await searchInput.pressSequentially(" ", { delay: 100 });
        sendLog('🔍 Searching for Dominos...', 'info');
        const dominosText = page.locator('p, span, a').filter({ hasText: /^dominos$/i }).first();

        let found = await dominosText.isVisible({ timeout: 4000 }).catch(() => false);
        if (!found) {
          sendLog('⚠️ Suggestion dropdown did not appear. Retrying search input...', 'warning');
          await page.locator('body').click({ force: true }).catch(() => { });
          await delay(500);
          await searchInput.click();
          await searchInput.fill('');
          await searchInput.fill('dominos');
          await searchInput.pressSequentially(' ', { delay: 100 });
          found = await dominosText.isVisible({ timeout: 4000 }).catch(() => false);
        }

        if (found) {
          await dominosText.click();
        } else {
          sendLog('⚠️ Direct suggestion click failed. Navigating directly to GrabOn Dominos page...', 'warning');
          await page.goto("https://www.grabon.in/dominos-coupons/", { waitUntil: 'domcontentloaded' });
        }
        await page.waitForLoadState('domcontentloaded');
        await solveCloudflareIfNeeded(page);
        const cards = page.locator('.gcbr, [id^="cpn_"]');
        await cards.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
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
        sendLog(`🎉 Scraped ${coupons.length} coupons from grabon.in`, 'success', coupons);
      }
    }

    if (coupons.length === 0) {
      sendLog('❌ No coupons found. Aborting.', 'error');
      res.end();
      await context.close().catch(() => { });
      browserClosed = true;
      return;
    }

    sendLog("🍕 Opening Domino's...", 'info');
    await page.bringToFront();
    await page.goto("https://www.dominos.co.in/", { waitUntil: 'domcontentloaded' }).catch(() => null);
    await page.getByText("ORDER ONLINE NOW").click();
    await page.getByText("skip").waitFor({ state: 'visible', timeout: 8000 }).catch(() => null);
    if (await page.getByText("skip").isVisible().catch(() => false)) {
      await page.getByText("skip").click();
    }
    await page.getByText("Ask Later").waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if (await page.getByText("Ask Later").isVisible().catch(() => false)) {
      await page.getByText("Ask Later").click();
    }

    const addressInput = page.getByPlaceholder(/Enter your delivery address|Enter delivery address/i).first();
    try {
      if (await addressInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        sendLog('📍 Setting location...', 'info');
        await addressInput.click();
        await addressInput.fill('Connaught Place, New Delhi');
        await page.waitForTimeout(2000);
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
    } catch (err) { }

    await page.getByText("Pizza Mania").click();
    await page.waitForTimeout(3000);

    const pizzasToAdd = ['Classic', 'Onion', 'Golden Corn', 'Classic Hand Tossed'];
    let currentSubtotal = 0;

    for (const pizza of pizzasToAdd) {
      if (currentSubtotal >= minCartValue) break;
      const targetCard = page.locator('.card-content').filter({
        has: page.locator('.pizza-title').getByText(pizza, { exact: true })
      });
      if (await targetCard.isVisible().catch(() => false)) {
        await targetCard.getByRole('button', { name: 'Add +' }).first().click();
        await page.waitForTimeout(1000);
        const viewCartText = await page.locator('div:has-text("View Cart")').first().innerText().catch(() => '');
        const match = viewCartText.match(/₹\s*(\d+)/);
        currentSubtotal = match ? parseInt(match[1]) : currentSubtotal + 100;
      }
    }

    await page.getByText("View Cart").click();
    await page.locator('div:has-text("Cart")').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.getByText("View All Offers").click();
    await page.getByPlaceholder("Type Offer code here…").waitFor({ state: 'visible', timeout: 5000 });

    const results = [];
    for (const coupon of coupons) {
      try {
        const input = page.getByPlaceholder("Type Offer code here…");
        await input.fill(coupon);
        await page.getByRole("button", { name: "Apply" }).first().click();
        await page.waitForTimeout(2000);
        const errorMsg = page.locator('[class*="OffersErrorMsg"], p:has-text("invalid"), p:has-text("expired")').first();
        const errorVisible = await errorMsg.isVisible().catch(() => false);
        if (errorVisible) {
          const text = await errorMsg.innerText().catch(() => 'Invalid');
          results.push({ coupon, status: 'FAILED', details: text });
          await input.fill('');
        } else {
          results.push({ coupon, status: 'SUCCESS', details: 'Applied successfully' });
          const removeBtn = page.locator('span:has-text("Remove"), button:has-text("Remove")');
          if (await removeBtn.isVisible().catch(() => false)) {
            await removeBtn.click();
            await page.waitForTimeout(1000);
            await page.getByText("View All Offers").click().catch(() => null);
          }
        }
      } catch (e) {
        results.push({ coupon, status: 'FAILED', details: e.message });
      }
      res.write(`data: ${JSON.stringify({ type: 'results', data: results })}\n\n`);
    }

    sendLog('🏁 Coupon verification run completed!', 'success');
    if (context) {
      await context.close().catch(() => { });
      browserClosed = true;
    }
    res.end();
  } catch (err) {
    sendLog(`❌ Execution error: ${err.message}`, 'error');
    if (context && !browserClosed) {
      await context.close().catch(() => { });
      browserClosed = true;
    }
    res.end();
  } finally {
    if (context && !browserClosed) await context.close().catch(() => { });
    if (browser) await browser.close().catch(() => { });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
