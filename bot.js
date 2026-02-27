const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Load config
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")
);

// --- Utility functions ---

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function gaussianRandom(mean, stddev) {
  // Box-Muller transform for Gaussian distribution
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(1, Math.round(mean + z * stddev));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Dashboard state ---

const dashboardState = {};
const logBuffer = [];
const LOG_BUFFER_MAX = 15;

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
  bgCyan: "\x1b[46m",
  bgGray: "\x1b[100m",
};

function truncate(str, len) {
  if (!str) return "".padEnd(len);
  return str.length > len ? str.substring(0, len - 1) + "\u2026" : str.padEnd(len);
}

function renderDashboard() {
  const cols = process.stdout.columns || 100;
  const clear = "\x1b[2J\x1b[H";
  const hr = C.gray + "\u2500".repeat(cols) + C.reset;

  let out = clear;

  // --- Top banner ---
  out += C.bold + C.cyan + "\n  TRAFIK SIMULASYON BOTU v2.0  " + C.reset + "\n";
  out += hr + "\n";

  const proxy = config.proxy?.enabled ? `AKTIF (${config.proxy.list.length})` : "KAPALI";
  out += `  ${C.white}Hedef:${C.reset} ${C.bold}${config.targetUrl}${C.reset}`;
  out += `   ${C.white}Oturum:${C.reset} ${config.sessions}`;
  out += `   ${C.white}Maks Sayfa:${C.reset} ${config.maxPages}`;
  out += `   ${C.white}Anti-Det:${C.reset} ${config.antiDetection ? C.green + "AKTIF" : C.red + "KAPALI"}${C.reset}`;
  out += `   ${C.white}Proxy:${C.reset} ${config.proxy?.enabled ? C.green + proxy : C.gray + proxy}${C.reset}`;
  out += "\n" + hr + "\n";

  // --- Session table ---
  const hdr = `  ${C.bold}${C.white}#   DURUM       SAYFA     IP               URL                              SON ISLEM${C.reset}`;
  out += hdr + "\n";

  const sessionIds = Object.keys(dashboardState).sort((a, b) => Number(a) - Number(b));
  for (const sid of sessionIds) {
    const s = dashboardState[sid];

    let statusLabel, statusColor;
    switch (s.status) {
      case "aktif":
        statusLabel = " AKTIF  ";
        statusColor = C.bgGreen + C.bold + " AKTIF  " + C.reset;
        break;
      case "tamam":
        statusLabel = " TAMAM  ";
        statusColor = C.bgCyan + C.bold + " TAMAM  " + C.reset;
        break;
      case "hata":
        statusLabel = " HATA   ";
        statusColor = C.bgRed + C.bold + " HATA   " + C.reset;
        break;
      case "bekliyor":
        statusLabel = " BEKLE  ";
        statusColor = C.bgYellow + C.bold + " BEKLE  " + C.reset;
        break;
      default:
        statusLabel = " ???    ";
        statusColor = C.gray + " ???    " + C.reset;
    }

    const pages = `${s.pagesVisited}/${s.maxPages}`.padEnd(9);
    const ip = (s.ip || "-").padEnd(16);
    const url = truncate(s.currentUrl || "-", 32);
    const action = truncate(s.lastAction || "-", 25);

    out += `  ${C.bold}${String(sid).padEnd(3)}${C.reset} ${statusColor} ${pages} ${C.dim}${ip}${C.reset} ${url} ${C.gray}${action}${C.reset}\n`;
  }

  if (sessionIds.length === 0) {
    out += `  ${C.gray}Henuz oturum baslatilmadi...${C.reset}\n`;
  }

  // --- Log section ---
  out += hr + "\n";
  out += `  ${C.bold}${C.white}--- LOG ---${C.reset}\n`;
  for (const line of logBuffer) {
    out += `  ${line}\n`;
  }

  // Pad remaining space
  out += "\n";

  process.stdout.write(out);
}

function log(sessionId, msg) {
  const time = new Date().toLocaleTimeString("tr-TR");
  const prefix = sessionId ? `${C.gray}[${time}]${C.reset} ${C.cyan}[Oturum ${sessionId}]${C.reset}` : `${C.gray}[${time}]${C.reset}`;
  const line = `${prefix} ${msg}`;
  logBuffer.push(line);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }
  renderDashboard();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bezier curve point calculation for natural mouse movement
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// --- Anti-detection script ---

const ANTI_DETECTION_SCRIPT = `
  // Hide navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => false });

  // Override plugins to look like a real browser
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ];
      plugins.length = 3;
      return plugins;
    }
  });

  // Override languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['tr-TR', 'tr', 'en-US', 'en']
  });

  // Override hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => [4, 8, 12, 16][Math.floor(Math.random() * 4)]
  });

  // Override deviceMemory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => [4, 8, 16][Math.floor(Math.random() * 3)]
  });

  // Override platform
  Object.defineProperty(navigator, 'platform', {
    get: () => 'Win32'
  });

  // Remove Chrome DevTools protocol traces
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

  // Remove automation-related properties
  const automationProps = [
    '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
    '__driver_unwrapped', '__webdriver_unwrapped', '__driver_evaluate',
    '__selenium_unwrapped', '__fxdriver_unwrapped', '_Selenium_IDE_Recorder',
    '_selenium', 'calledSelenium', '_WEBDRIVER_ELEM_CACHE',
    'ChromeDriverw', 'driver-hierarchically', '__webdriverFunc',
    '__lastWatirAlert', '__lastWatirConfirm', '__lastWatirPrompt',
    '$chrome_asyncScriptInfo', '$cdc_asdjflasutopfhvcZLmcfl_'
  ];
  automationProps.forEach(prop => {
    try { delete window[prop]; } catch(e) {}
    try { delete document[prop]; } catch(e) {}
  });

  // Fake WebGL vendor/renderer
  const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Google Inc. (NVIDIA)';        // UNMASKED_VENDOR_WEBGL
    if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'; // UNMASKED_RENDERER_WEBGL
    return getParameterOrig.call(this, param);
  };

  // Also for WebGL2
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParam2Orig.call(this, param);
    };
  }

  // Override permissions query
  const origQuery = window.Permissions.prototype.query;
  window.Permissions.prototype.query = function(params) {
    if (params.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return origQuery.call(this, params);
  };

  // Override chrome.runtime to mimic a real Chrome browser
  window.chrome = {
    runtime: {
      connect: function() {},
      sendMessage: function() {}
    },
    loadTimes: function() {
      return {};
    },
    csi: function() {
      return {};
    }
  };

  // Override toString for modified functions to prevent detection
  const nativeToString = Function.prototype.toString;
  Function.prototype.toString = function() {
    if (this === Function.prototype.toString) return 'function toString() { [native code] }';
    if (this === navigator.__lookupGetter__('webdriver')) return 'function get webdriver() { [native code] }';
    return nativeToString.call(this);
  };
`;

// --- Referrer override script ---

function createReferrerScript(referrer) {
  return `
    Object.defineProperty(document, 'referrer', {
      get: () => '${referrer}'
    });
  `;
}

// --- Core bot logic ---

async function simulateHumanScroll(page) {
  const scrolls = randomBetween(3, 8);
  for (let i = 0; i < scrolls; i++) {
    // Bidirectional scrolling: mostly down, sometimes up
    const direction = Math.random() < 0.75 ? 1 : -1;
    const distance = randomBetween(100, 500) * direction;
    await page.mouse.wheel(0, distance);
    await page.waitForTimeout(randomBetween(500, 2000));
  }
}

async function simulateNaturalMouseMovement(page) {
  const moves = randomBetween(2, 5);
  for (let i = 0; i < moves; i++) {
    // Current position (approximate or start from random)
    const startX = randomBetween(100, 600);
    const startY = randomBetween(100, 400);
    const endX = randomBetween(200, 1200);
    const endY = randomBetween(100, 700);

    // Control points for bezier curve (creates natural arc)
    const cp1x = startX + (endX - startX) * 0.25 + randomBetween(-100, 100);
    const cp1y = startY + (endY - startY) * 0.25 + randomBetween(-100, 100);
    const cp2x = startX + (endX - startX) * 0.75 + randomBetween(-100, 100);
    const cp2y = startY + (endY - startY) * 0.75 + randomBetween(-100, 100);

    const steps = randomBetween(15, 30);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = Math.round(bezierPoint(t, startX, cp1x, cp2x, endX));
      const y = Math.round(bezierPoint(t, startY, cp1y, cp2y, endY));
      await page.mouse.move(x, y);
      await page.waitForTimeout(randomBetween(5, 25));
    }

    await page.waitForTimeout(randomBetween(200, 800));
  }
}

async function simulateRandomClick(page) {
  // Click on a non-link area (body content) to simulate reading engagement
  try {
    const bodyBox = await page.evaluate(() => {
      const body = document.body;
      return {
        width: body.scrollWidth,
        height: Math.min(body.scrollHeight, window.innerHeight)
      };
    });
    const x = randomBetween(100, Math.min(bodyBox.width - 100, 1200));
    const y = randomBetween(100, Math.min(bodyBox.height - 100, 600));
    await page.mouse.click(x, y);
  } catch (_) {
    // Ignore click errors silently
  }
}

async function simulateBackNavigation(page, sessionId) {
  try {
    if (Math.random() < 0.2) {
      log(sessionId, "Geri butonu kullaniliyor...");
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 });
      await page.waitForTimeout(randomBetween(1000, 3000));
      return true;
    }
  } catch (_) {
    // Ignore back navigation errors
  }
  return false;
}

function gaussianWait(minSec, maxSec) {
  const mean = (minSec + maxSec) / 2;
  const stddev = (maxSec - minSec) / 4;
  const val = gaussianRandom(mean, stddev);
  return Math.max(minSec, Math.min(maxSec, val));
}

async function getInternalLinks(page, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const links = await page.evaluate((orig) => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    return anchors
      .map((a) => a.href)
      .filter(
        (href) =>
          href.startsWith(orig) &&
          !href.includes("#") &&
          !href.match(/\.(pdf|jpg|jpeg|png|gif|svg|zip|mp4|mp3)$/i)
      );
  }, origin);

  return [...new Set(links)];
}

async function checkProxyIP(page, sessionId) {
  try {
    const response = await page.goto("https://api.ipify.org?format=json", {
      timeout: 15000,
    });
    const body = await response.json();
    if (dashboardState[sessionId]) {
      dashboardState[sessionId].ip = body.ip;
    }
    log(sessionId, `Baglanti IP adresi: ${body.ip}`);
    return body.ip;
  } catch (err) {
    log(sessionId, `IP kontrol edilemedi: ${err.message}`);
    return null;
  }
}

// --- Proxy health check with fallback ---

async function launchBrowserWithProxy(sessionId, proxyList) {
  if (!config.proxy || !config.proxy.enabled || proxyList.length === 0) {
    log(sessionId, "Proxy kullanilmiyor, dogrudan baglanti.");
    return await chromium.launch({ headless: true });
  }

  // Shuffle proxy list to distribute load
  const shuffled = [...proxyList].sort(() => Math.random() - 0.5);

  for (const proxyUrl of shuffled) {
    try {
      log(sessionId, `Proxy deneniyor: ${proxyUrl}`);
      const browser = await chromium.launch({
        headless: true,
        proxy: { server: proxyUrl },
      });

      // Quick connectivity test
      const testContext = await browser.newContext();
      const testPage = await testContext.newPage();
      try {
        await testPage.goto("https://api.ipify.org?format=json", { timeout: 10000 });
        const body = await testPage.evaluate(() => document.body.innerText);
        const ip = JSON.parse(body).ip;
        if (dashboardState[sessionId]) {
          dashboardState[sessionId].ip = ip;
        }
        log(sessionId, `Proxy calisiyor! IP: ${ip} (${proxyUrl})`);
        await testContext.close();
        return browser;
      } catch (testErr) {
        log(sessionId, `Proxy basarisiz: ${proxyUrl} - ${testErr.message}`);
        await browser.close();
        continue;
      }
    } catch (launchErr) {
      log(sessionId, `Proxy baglanti hatasi: ${proxyUrl} - ${launchErr.message}`);
      continue;
    }
  }

  // All proxies failed — fallback to direct connection
  log(sessionId, "UYARI: Tum proxyler basarisiz! Dogrudan baglanti kullaniliyor.");
  return await chromium.launch({ headless: true });
}

// --- Core session logic ---

async function runSession(sessionId) {
  const userAgent = pickRandom(config.userAgents);
  const viewport = pickRandom(config.viewports);
  const referrer = pickRandom(config.referrers || []);

  // Initialize dashboard state for this session
  dashboardState[sessionId] = {
    status: "aktif",
    currentUrl: "-",
    pagesVisited: 0,
    maxPages: config.maxPages,
    ip: "-",
    referrer: referrer ? referrer.substring(0, 40) : "-",
    lastAction: "Baslatiliyor",
    errors: 0,
  };

  log(sessionId, `Baslatiliyor... (${viewport.width}x${viewport.height})`);
  if (referrer) {
    log(sessionId, `Referrer: ${referrer.substring(0, 60)}...`);
  }

  let browser;
  try {
    dashboardState[sessionId].lastAction = "Tarayici aciliyor";
    renderDashboard();
    browser = await launchBrowserWithProxy(sessionId, config.proxy?.list || []);
  } catch (err) {
    dashboardState[sessionId].status = "hata";
    dashboardState[sessionId].lastAction = "Tarayici hatasi";
    dashboardState[sessionId].errors++;
    log(sessionId, `Tarayici baslatilamadi: ${err.message}`);
    return { sessionId, pagesVisited: 0, urls: [] };
  }

  let context;
  try {
    context = await browser.newContext({
      userAgent,
      viewport,
      locale: "tr-TR",
      timezoneId: "Europe/Nicosia",
    });

    // Anti-detection injection
    if (config.antiDetection) {
      await context.addInitScript(ANTI_DETECTION_SCRIPT);
      dashboardState[sessionId].lastAction = "Anti-det yuklendi";
      renderDashboard();
    }

    // Referrer injection
    if (referrer) {
      await context.addInitScript(createReferrerScript(referrer));
    }
  } catch (err) {
    dashboardState[sessionId].status = "hata";
    dashboardState[sessionId].lastAction = "Context hatasi";
    dashboardState[sessionId].errors++;
    log(sessionId, `Context olusturulamadi: ${err.message}`);
    await browser.close();
    return { sessionId, pagesVisited: 0, urls: [] };
  }

  const page = await context.newPage();
  const visitedUrls = new Set();
  let pagesVisited = 0;

  try {
    // Visit the target URL
    dashboardState[sessionId].lastAction = "Ana sayfa aciliyor";
    dashboardState[sessionId].currentUrl = config.targetUrl;
    renderDashboard();
    log(sessionId, `Ana sayfa aciliyor: ${config.targetUrl}`);
    await page.goto(config.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    visitedUrls.add(config.targetUrl);
    pagesVisited++;
    dashboardState[sessionId].pagesVisited = pagesVisited;
    dashboardState[sessionId].lastAction = "Scroll & mouse";
    renderDashboard();

    // Simulate human behavior on first page
    await simulateNaturalMouseMovement(page);
    if (config.scrollPage) {
      await simulateHumanScroll(page);
    }

    // Random click on content area
    if (Math.random() < 0.4) {
      await simulateRandomClick(page);
    }

    const waitSec = gaussianWait(config.waitTime.min, config.waitTime.max);
    dashboardState[sessionId].lastAction = `Bekleme ${waitSec}sn`;
    renderDashboard();
    log(sessionId, `Ana sayfada ${waitSec} saniye bekleniyor...`);
    await page.waitForTimeout(waitSec * 1000);

    // Navigate through internal pages
    while (pagesVisited < config.maxPages) {
      const links = await getInternalLinks(page, config.targetUrl);
      const unvisited = links.filter((l) => !visitedUrls.has(l));

      if (unvisited.length === 0) {
        log(sessionId, `Ziyaret edilecek yeni sayfa kalmadi.`);
        break;
      }

      const nextUrl = pickRandom(unvisited);
      dashboardState[sessionId].currentUrl = nextUrl;
      dashboardState[sessionId].lastAction = "Sayfa aciliyor";
      renderDashboard();
      log(
        sessionId,
        `[${pagesVisited + 1}/${config.maxPages}] Ziyaret ediliyor: ${nextUrl}`
      );

      try {
        await page.goto(nextUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (navErr) {
        dashboardState[sessionId].errors++;
        dashboardState[sessionId].lastAction = "Sayfa hatasi";
        renderDashboard();
        log(sessionId, `Sayfa acilamadi: ${navErr.message}. Devam ediliyor...`);
        continue;
      }

      visitedUrls.add(nextUrl);
      pagesVisited++;
      dashboardState[sessionId].pagesVisited = pagesVisited;
      dashboardState[sessionId].lastAction = "Scroll & mouse";
      renderDashboard();

      // Simulate human behavior
      await simulateNaturalMouseMovement(page);
      if (config.scrollPage) {
        await simulateHumanScroll(page);
      }

      // Random content click
      if (Math.random() < 0.3) {
        await simulateRandomClick(page);
      }

      // Occasionally go back
      const wentBack = await simulateBackNavigation(page, sessionId);
      if (wentBack) {
        dashboardState[sessionId].lastAction = "Geri navigasyon";
        renderDashboard();
        await simulateHumanScroll(page);
      }

      const pageSec = gaussianWait(config.waitTime.min, config.waitTime.max);
      dashboardState[sessionId].lastAction = `Bekleme ${pageSec}sn`;
      renderDashboard();
      log(sessionId, `Bu sayfada ${pageSec} saniye bekleniyor...`);
      await page.waitForTimeout(pageSec * 1000);
    }

    dashboardState[sessionId].status = "tamam";
    dashboardState[sessionId].lastAction = "Tamamlandi";
    renderDashboard();
    log(sessionId, `Tamamlandi! Toplam ${pagesVisited} sayfa ziyaret edildi.`);
  } catch (err) {
    dashboardState[sessionId].status = "hata";
    dashboardState[sessionId].lastAction = "HATA";
    dashboardState[sessionId].errors++;
    renderDashboard();
    log(sessionId, `HATA: ${err.message}`);
  } finally {
    try {
      await browser.close();
    } catch (_) {
      // Silently ignore close errors
    }
  }

  return { sessionId, pagesVisited, urls: [...visitedUrls] };
}

// --- Main: Sequential sessions with random delay ---

async function main() {
  // Initial render
  renderDashboard();
  log(null, "Bot baslatiliyor...");

  // Run sessions sequentially with random delays (not parallel!)
  const results = [];
  for (let i = 1; i <= config.sessions; i++) {
    const result = await runSession(i);
    results.push(result);

    // Random delay between sessions — mark completed session as waiting
    if (i < config.sessions && config.sessionDelay) {
      const delaySec = randomBetween(config.sessionDelay.min, config.sessionDelay.max);

      // Pre-init next session slot as "bekliyor"
      dashboardState[i + 1] = {
        status: "bekliyor",
        currentUrl: "-",
        pagesVisited: 0,
        maxPages: config.maxPages,
        ip: "-",
        referrer: "-",
        lastAction: `${delaySec}sn bekleme`,
        errors: 0,
      };

      log(null, `Sonraki oturum icin ${delaySec} saniye bekleniyor...`);
      await sleep(delaySec * 1000);
    }
  }

  // Final summary in log
  log(null, `${C.bold}${C.green}Tum oturumlar tamamlandi!${C.reset}`);
  results.forEach((r) => {
    log(null, `Oturum ${r.sessionId}: ${r.pagesVisited} sayfa ziyaret edildi`);
  });
}

main().catch(console.error);
