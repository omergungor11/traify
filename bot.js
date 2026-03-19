const { chromium: vanillaChromium, firefox } = require("playwright");
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

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
  out += C.bold + C.cyan + "\n  TRAFIK SIMULASYON BOTU v3.0 (Stealth)  " + C.reset + "\n";
  out += hr + "\n";

  const proxy = config.proxy?.enabled ? `AKTIF (${config.proxy.list.length})` : "KAPALI";
  const organicPct = config.organicSearch?.enabled ? `%${config.organicSearch.percentage}` : "KAPALI";
  out += `  ${C.white}Hedef:${C.reset} ${C.bold}${config.targetUrl}${C.reset}`;
  out += `   ${C.white}Oturum:${C.reset} ${config.sessions}`;
  out += `   ${C.white}Maks Sayfa:${C.reset} ${config.maxPages}`;
  out += `   ${C.white}Organik:${C.reset} ${config.organicSearch?.enabled ? C.green + organicPct : C.gray + organicPct}${C.reset}`;
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

// --- Fingerprint Profiles (tutarli degerler) ---

const FINGERPRINT_PROFILES = [
  {
    platform: "Win32",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentMatch: "Windows",
    gpuVendor: "Google Inc. (NVIDIA)",
    gpuRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screen: { width: 1920, height: 1080, colorDepth: 24 },
  },
  {
    platform: "Win32",
    hardwareConcurrency: 12,
    deviceMemory: 16,
    userAgentMatch: "Windows",
    gpuVendor: "Google Inc. (NVIDIA)",
    gpuRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    screen: { width: 2560, height: 1440, colorDepth: 24 },
  },
  {
    platform: "MacIntel",
    hardwareConcurrency: 10,
    deviceMemory: 16,
    userAgentMatch: "Macintosh",
    gpuVendor: "Google Inc. (Apple)",
    gpuRenderer: "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)",
    screen: { width: 2560, height: 1440, colorDepth: 30 },
  },
  {
    platform: "MacIntel",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentMatch: "Macintosh",
    gpuVendor: "Google Inc. (Apple)",
    gpuRenderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)",
    screen: { width: 1440, height: 900, colorDepth: 30 },
  },
  {
    platform: "Linux x86_64",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgentMatch: "Linux",
    gpuVendor: "Google Inc. (AMD)",
    gpuRenderer: "ANGLE (AMD, Radeon RX 580 Series, OpenGL 4.6)",
    screen: { width: 1920, height: 1080, colorDepth: 24 },
  },
];

function selectProfileForUA(userAgent) {
  // UA'ya uygun profil sec
  const matching = FINGERPRINT_PROFILES.filter(p =>
    userAgent.includes(p.userAgentMatch)
  );
  if (matching.length > 0) return pickRandom(matching);
  return pickRandom(FINGERPRINT_PROFILES);
}

// --- Anti-detection scripts ---

// Chromium icin: stealth plugin + ek evasion'lar (profil bazli)
function createStealthCompatScript(profile) {
  return `
    // --- Profil bazli tutarli degerler ---
    Object.defineProperty(navigator, 'platform', { get: () => '${profile.platform}' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${profile.deviceMemory} });
    Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });

    // --- navigator.connection (Network Information API) ---
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: ${pickRandom([50, 75, 100])},
          downlink: ${pickRandom([5, 10, 15])},
          saveData: false,
        })
      });
    }

    // --- outerWidth/outerHeight farki (headless = inner, gercek != inner) ---
    const _toolbarH = ${pickRandom([73, 79, 85, 91])};
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + _toolbarH });
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16 });

    // --- Screen tutarliligi ---
    Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.screen.colorDepth} });

    // --- WebGL profil bazli ---
    const _gpuVendor = '${profile.gpuVendor}';
    const _gpuRenderer = '${profile.gpuRenderer}';
    const _origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return _gpuVendor;
      if (param === 37446) return _gpuRenderer;
      return _origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const _origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return _gpuVendor;
        if (param === 37446) return _gpuRenderer;
        return _origGetParam2.call(this, param);
      };
    }

    // --- Canvas fingerprint noise ---
    const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imgData = ctx.getImageData(0, 0, Math.min(this.width, 256), Math.min(this.height, 256));
          for (let i = 0; i < imgData.data.length; i += 100) {
            imgData.data[i] = imgData.data[i] ^ 1;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch(_) {}
      }
      return _origToDataURL.call(this, type);
    };

    // --- AudioContext fingerprint noise ---
    if (typeof AnalyserNode !== 'undefined') {
      const _origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        _origGetFloat.call(this, array);
        for (let i = 0; i < array.length; i += 10) {
          array[i] = array[i] + (Math.random() * 0.1 - 0.05);
        }
      };
    }

    // --- Permissions query patch ---
    if (window.Permissions && window.Permissions.prototype.query) {
      const _origQuery = window.Permissions.prototype.query;
      window.Permissions.prototype.query = function(params) {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return _origQuery.call(this, params);
      };
    }
  `;
}

// Firefox icin: tam legacy script (stealth plugin Firefox desteklemiyor)
function createFirefoxAntiDetectionScript(profile) {
  return `
    // --- navigator overrides ---
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'platform', { get: () => '${profile.platform}' });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${profile.hardwareConcurrency} });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => ${profile.deviceMemory} });
    Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });

    // --- Plugins ---
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

    // --- navigator.connection ---
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: ${pickRandom([50, 75, 100])},
          downlink: ${pickRandom([5, 10, 15])},
          saveData: false,
        })
      });
    }

    // --- outerWidth/outerHeight ---
    const _toolbarH = ${pickRandom([73, 79, 85, 91])};
    Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + _toolbarH });
    Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth + 16 });

    // --- Screen ---
    Object.defineProperty(screen, 'colorDepth', { get: () => ${profile.screen.colorDepth} });

    // --- Remove automation traces ---
    const automationProps = [
      '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
      '__driver_unwrapped', '__webdriver_unwrapped', '__driver_evaluate',
      '__selenium_unwrapped', '__fxdriver_unwrapped', '_Selenium_IDE_Recorder',
      '_selenium', 'calledSelenium', '_WEBDRIVER_ELEM_CACHE',
      'ChromeDriverw', '__webdriverFunc',
      '$chrome_asyncScriptInfo', '$cdc_asdjflasutopfhvcZLmcfl_'
    ];
    automationProps.forEach(prop => {
      try { delete window[prop]; } catch(e) {}
      try { delete document[prop]; } catch(e) {}
    });

    // --- WebGL profil bazli ---
    const _gpuVendor = '${profile.gpuVendor}';
    const _gpuRenderer = '${profile.gpuRenderer}';
    const _origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return _gpuVendor;
      if (param === 37446) return _gpuRenderer;
      return _origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const _origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 37445) return _gpuVendor;
        if (param === 37446) return _gpuRenderer;
        return _origGetParam2.call(this, param);
      };
    }

    // --- Canvas fingerprint noise ---
    const _origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      const ctx = this.getContext('2d');
      if (ctx && this.width > 0 && this.height > 0) {
        try {
          const imgData = ctx.getImageData(0, 0, Math.min(this.width, 256), Math.min(this.height, 256));
          for (let i = 0; i < imgData.data.length; i += 100) {
            imgData.data[i] = imgData.data[i] ^ 1;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch(_) {}
      }
      return _origToDataURL.call(this, type);
    };

    // --- AudioContext fingerprint noise ---
    if (typeof AnalyserNode !== 'undefined') {
      const _origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
      AnalyserNode.prototype.getFloatFrequencyData = function(array) {
        _origGetFloat.call(this, array);
        for (let i = 0; i < array.length; i += 10) {
          array[i] = array[i] + (Math.random() * 0.1 - 0.05);
        }
      };
    }

    // --- Permissions ---
    if (window.Permissions && window.Permissions.prototype.query) {
      const _origQuery = window.Permissions.prototype.query;
      window.Permissions.prototype.query = function(params) {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return _origQuery.call(this, params);
      };
    }

    // --- chrome object for non-Chrome browsers ---
    if (!window.chrome) {
      window.chrome = {
        runtime: { connect: function() {}, sendMessage: function() {} },
        loadTimes: function() { return {}; },
        csi: function() { return {}; }
      };
    }

    // --- toString override ---
    const nativeToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === Function.prototype.toString) return 'function toString() { [native code] }';
      return nativeToString.call(this);
    };
  `;
}

// --- Referrer override script ---

function createReferrerScript(referrer) {
  return `
    Object.defineProperty(document, 'referrer', {
      get: () => '${referrer}'
    });
  `;
}

// --- Google Organic Search functions ---

async function handleGoogleConsent(page, sessionId) {
  try {
    // Google cookie consent dialog — multiple selectors for different regions
    const consentSelectors = [
      'button[id="L2AGLb"]',           // "I agree" button
      'button[id="W0wltc"]',           // "Reject all" button
      'button:has-text("Tümünü kabul et")',
      'button:has-text("Accept all")',
      'button:has-text("Kabul ediyorum")',
      'form[action*="consent"] button',
    ];

    for (const sel of consentSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await page.waitForTimeout(randomBetween(500, 1500));
        await btn.click();
        log(sessionId, "Google cerez dialogu kapatildi.");
        await page.waitForTimeout(randomBetween(1000, 2000));
        return true;
      }
    }
  } catch (_) {
    // No consent dialog — that's fine
  }
  return false;
}

async function humanType(page, selector, text, sessionId) {
  await page.click(selector);
  await page.waitForTimeout(randomBetween(300, 800));

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // %5 ihtimalle typo yap ve düzelt
    if (Math.random() < 0.05 && i > 0 && i < text.length - 1) {
      const typoChar = String.fromCharCode(char.charCodeAt(0) + randomBetween(-1, 1));
      await page.keyboard.type(typoChar, { delay: randomBetween(30, 80) });
      await page.waitForTimeout(randomBetween(200, 500));
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(randomBetween(100, 300));
    }

    const baseSpeed = randomBetween(
      config.organicSearch.typingSpeed.min,
      config.organicSearch.typingSpeed.max
    );
    // Jitter: +-30ms rastgele sapma
    const jitter = randomBetween(-30, 30);
    let speed = Math.max(30, baseSpeed + jitter);

    // Space karakteri icin daha uzun duraklama (kelime arasi)
    if (char === ' ') speed += randomBetween(40, 120);

    // Buyuk harf icin ekstra gecikme (shift basma)
    if (char !== char.toLowerCase() && char === char.toUpperCase() && char.match(/[A-Z]/)) {
      speed += randomBetween(20, 60);
    }

    await page.keyboard.type(char, { delay: speed });

    // Arada rastgele duraklama (düşünüyor efekti)
    if (Math.random() < 0.1) {
      await page.waitForTimeout(randomBetween(300, 800));
    }
  }

  log(sessionId, `Yazildi: "${text}"`);
}

async function naturalMouseMoveToTarget(page, box) {
  const targetX = box.x + box.width / 2 + randomBetween(-10, 10);
  const targetY = box.y + box.height / 2 + randomBetween(-3, 3);

  // Mevcut pozisyondan hedefe bezier eğrisi ile git
  const startX = randomBetween(200, 600);
  const startY = randomBetween(100, 300);
  const cp1x = startX + (targetX - startX) * 0.3 + randomBetween(-50, 50);
  const cp1y = startY + (targetY - startY) * 0.3 + randomBetween(-30, 30);
  const cp2x = startX + (targetX - startX) * 0.7 + randomBetween(-50, 50);
  const cp2y = startY + (targetY - startY) * 0.7 + randomBetween(-30, 30);

  const steps = randomBetween(20, 35);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(bezierPoint(t, startX, cp1x, cp2x, targetX));
    const y = Math.round(bezierPoint(t, startY, cp1y, cp2y, targetY));
    await page.mouse.move(x, y);
    await page.waitForTimeout(randomBetween(5, 20));
  }
}

async function findTargetInResults(page, targetHostname) {
  // Google sonuçlarındaki tüm linkleri tara, hedef hostname'i bul
  const results = await page.$$('div#search a[href]');
  for (const link of results) {
    const href = await link.getAttribute('href');
    if (!href) continue;
    try {
      const linkHost = new URL(href).hostname.replace('www.', '');
      const target = targetHostname.replace('www.', '');
      if (linkHost === target || linkHost.endsWith('.' + target)) {
        const box = await link.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          return { element: link, box, href };
        }
      }
    } catch (_) {
      continue;
    }
  }
  return null;
}

async function goToNextGooglePage(page, sessionId) {
  try {
    const nextBtn = await page.$('a#pnnext, a[aria-label="Next"], td.navend a');
    if (nextBtn) {
      const box = await nextBtn.boundingBox();
      if (box) {
        await naturalMouseMoveToTarget(page, box);
        await page.waitForTimeout(randomBetween(200, 500));
        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 15000 });
        await page.waitForTimeout(randomBetween(1500, 3000));
        log(sessionId, "Sonraki Google sayfasina gecildi.");
        return true;
      }
    }
  } catch (err) {
    log(sessionId, `Sonraki sayfa hatasi: ${err.message}`);
  }
  return false;
}

async function fallbackDirectVisit(page, context, sessionId, query) {
  // Google organik referrer URL'si oluştur (GA bunu "Organic Search" olarak görür)
  const searchQuery = query || pickRandom(config.organicSearch?.searchQueries || ["kibris nights club"]);
  const googleDomain = pickRandom(config.organicSearch?.googleDomains || ["https://www.google.com"]);
  const organicReferer = `${googleDomain}/search?q=${encodeURIComponent(searchQuery)}`;

  log(sessionId, `Fallback organik referrer: ${organicReferer.substring(0, 60)}`);
  dashboardState[sessionId].lastAction = "Fallback: organik ref";
  renderDashboard();

  // HTTP Referer header ayarla (GA bunu okur)
  await context.setExtraHTTPHeaders({
    'Referer': organicReferer,
  });

  // Ayrıca document.referrer JS override
  await context.addInitScript(createReferrerScript(organicReferer));

  await page.goto(config.targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
    referer: organicReferer,
  });
}

// Mouse micro-movements — aramadan once sayfada gezinme
async function mouseIdleMovements(page) {
  const moves = randomBetween(3, 6);
  for (let i = 0; i < moves; i++) {
    const x = randomBetween(100, 800);
    const y = randomBetween(100, 500);
    await page.mouse.move(x, y, { steps: randomBetween(5, 15) });
    await page.waitForTimeout(randomBetween(200, 600));
  }
}

// Tiklamadan once hedefe yaklasip kucuk tereddut
async function hoverHesitate(page, box) {
  // Once yakin bir noktaya git
  const nearX = box.x + box.width / 2 + randomBetween(-30, 30);
  const nearY = box.y + box.height / 2 + randomBetween(-20, 20);
  await page.mouse.move(nearX, nearY, { steps: randomBetween(8, 15) });
  await page.waitForTimeout(randomBetween(150, 400));

  // Sonra tam hedefe
  const exactX = box.x + box.width / 2 + randomBetween(-5, 5);
  const exactY = box.y + box.height / 2 + randomBetween(-2, 2);
  await page.mouse.move(exactX, exactY, { steps: randomBetween(3, 8) });
  await page.waitForTimeout(randomBetween(50, 200));
}

async function performGoogleOrganicSearch(page, context, sessionId, query) {
  const organic = config.organicSearch;
  const googleUrl = pickRandom(organic.googleDomains);
  const targetHostname = new URL(config.targetUrl).hostname;

  // 1. Google'a git
  dashboardState[sessionId].lastAction = "Google aciliyor";
  dashboardState[sessionId].currentUrl = googleUrl;
  renderDashboard();
  log(sessionId, `Google aciliyor: ${googleUrl}`);

  await page.goto(googleUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  // Sayfa yuklenme sonrasi insan gibi bekleme
  await page.waitForTimeout(randomBetween(1500, 3000));

  // Sayfada rastgele mouse hareketi (insan gibi gezinme)
  await mouseIdleMovements(page);

  // 2. Çerez dialogunu kapat
  await handleGoogleConsent(page, sessionId);

  // 3. Arama kutusuna tıkla ve yaz
  const searchSelector = 'textarea[name="q"], input[name="q"]';
  await page.waitForSelector(searchSelector, { timeout: 10000 });

  dashboardState[sessionId].lastAction = `Yaziliyor: ${query.substring(0, 15)}`;
  renderDashboard();
  await humanType(page, searchSelector, query, sessionId);

  // 4. Enter'a bas
  await page.waitForTimeout(randomBetween(500, 1200));
  await page.keyboard.press('Enter');
  dashboardState[sessionId].lastAction = "Sonuclar bekleniyor";
  renderDashboard();

  // Sonuçları bekle — navigate + selector
  let searchResultsFound = false;
  try {
    // Enter sonrası sayfa geçişini bekle
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
    await page.waitForTimeout(randomBetween(2000, 4000));

    // URL'de /search olduğunu doğrula
    const currentUrl = page.url();
    log(sessionId, `Arama sonrasi URL: ${currentUrl.substring(0, 80)}`);

    // Farklı selector'ları dene
    const selectors = ['div#search', 'div#rso', 'div.g', 'div[data-hveid]', '#botstuff', '#res'];
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) {
        searchResultsFound = true;
        log(sessionId, "Arama sonuclari yuklendi.");
        break;
      }
    }
  } catch (_) {
    // Timeout — sayfayı kontrol et
  }

  if (!searchResultsFound) {
    const pageUrl = page.url();

    // Gerçek CAPTCHA kontrolü — URL bazlı (en güvenilir)
    if (pageUrl.includes('/sorry/') || pageUrl.includes('sorry')) {
      log(sessionId, "CAPTCHA tespit edildi (URL)! Fallback kullaniliyor.");
      await fallbackDirectVisit(page, context, sessionId, query);
      return;
    }

    // İçerik bazlı CAPTCHA kontrolü
    const pageContent = await page.content();
    const lowerContent = pageContent.toLowerCase();
    const isCaptcha = lowerContent.includes('recaptcha') ||
      lowerContent.includes('unusual traffic') ||
      lowerContent.includes('automated queries');

    if (isCaptcha) {
      log(sessionId, "CAPTCHA tespit edildi (icerik)! Fallback kullaniliyor.");
      await fallbackDirectVisit(page, context, sessionId, query);
      return;
    }

    // Sayfa debug — screenshot al
    try {
      await page.screenshot({ path: `/tmp/google-debug-${sessionId}.png` });
      log(sessionId, `Debug screenshot: /tmp/google-debug-${sessionId}.png`);
    } catch (_) {}

    log(sessionId, "Sonuclar bulunamadi, fallback kullaniliyor.");
    await fallbackDirectVisit(page, context, sessionId, query);
    return;
  }
  await page.waitForTimeout(randomBetween(1500, 3000));

  // 5. Sonuçlarda hedefi ara (maxSearchPages kadar dene)
  for (let pageNum = 1; pageNum <= organic.maxSearchPages; pageNum++) {
    log(sessionId, `Google sayfa ${pageNum} taraniyor (hedef: ${targetHostname})`);

    // Sonuçlara göz at — scroll ile insan gibi oku
    await simulateHumanScroll(page);
    await page.waitForTimeout(randomBetween(1000, 2000));

    const found = await findTargetInResults(page, targetHostname);
    if (found) {
      log(sessionId, `Hedef bulundu! ${found.href}`);
      dashboardState[sessionId].lastAction = "Hedefe tiklaniyor";
      renderDashboard();

      // Hedefe dogal mouse hareketi + tereddut + tiklama
      await naturalMouseMoveToTarget(page, found.box);
      await hoverHesitate(page, found.box);
      await page.waitForTimeout(randomBetween(200, 500));
      await found.element.click();

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      } catch (_) {
        // Timeout olsa bile sayfa yüklendi varsay
      }

      log(sessionId, `Organik tikla ile siteye girildi!`);
      dashboardState[sessionId].lastAction = "Organik giris OK";
      dashboardState[sessionId].currentUrl = config.targetUrl;
      renderDashboard();
      return;
    }

    // Bulunamadı — sonraki sayfaya geç
    if (pageNum < organic.maxSearchPages) {
      const wentNext = await goToNextGooglePage(page, sessionId);
      if (!wentNext) break;
    }
  }

  // Hiçbir sayfada bulunamadı
  await fallbackDirectVisit(page, context, sessionId, query);
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

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-service-autorun',
];

async function launchBrowserWithProxy(sessionId, proxyList, useFirefox = false) {
  const engine = useFirefox ? firefox : chromium;
  const engineName = useFirefox ? "Firefox" : "Chromium";
  const launchOpts = useFirefox
    ? { headless: true }
    : { headless: true, args: BROWSER_ARGS };

  if (!config.proxy || !config.proxy.enabled || proxyList.length === 0) {
    log(sessionId, `Proxy kullanilmiyor, ${engineName} ile dogrudan baglanti.`);
    return await engine.launch(launchOpts);
  }

  // Shuffle proxy list to distribute load
  const shuffled = [...proxyList].sort(() => Math.random() - 0.5);

  for (const proxyUrl of shuffled) {
    try {
      log(sessionId, `Proxy deneniyor: ${proxyUrl}`);
      const browser = await engine.launch({
        ...launchOpts,
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
  log(sessionId, `UYARI: Tum proxyler basarisiz! ${engineName} ile dogrudan baglanti.`);
  return await engine.launch(launchOpts);
}

// --- Core session logic ---

const FIREFOX_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
];

async function runSession(sessionId) {
  const viewport = pickRandom(config.viewports);
  const referrer = pickRandom(config.referrers || []);

  // Organik mi referrer mi karar ver
  const organic = config.organicSearch;
  const useOrganic = organic && organic.enabled && Math.random() * 100 < organic.percentage;
  const modeLabel = useOrganic ? "ORGANIK" : "REFERRER";
  const userAgent = useOrganic ? pickRandom(FIREFOX_USER_AGENTS) : pickRandom(config.userAgents);

  // Tutarli fingerprint profili sec (session boyunca sabit)
  const profile = selectProfileForUA(userAgent);

  // Initialize dashboard state for this session
  dashboardState[sessionId] = {
    status: "aktif",
    currentUrl: "-",
    pagesVisited: 0,
    maxPages: config.maxPages,
    ip: "-",
    referrer: useOrganic ? "Google Organic" : (referrer ? referrer.substring(0, 40) : "-"),
    lastAction: "Baslatiliyor",
    errors: 0,
  };

  log(sessionId, `Baslatiliyor [${modeLabel}]... (${viewport.width}x${viewport.height}) [${profile.platform}]`);
  if (!useOrganic && referrer) {
    log(sessionId, `Referrer: ${referrer.substring(0, 60)}...`);
  }

  let browser;
  try {
    dashboardState[sessionId].lastAction = "Tarayici aciliyor";
    renderDashboard();
    browser = await launchBrowserWithProxy(sessionId, config.proxy?.list || [], useOrganic);
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
      timezoneId: useOrganic ? "Asia/Famagusta" : "Europe/Nicosia",
    });

    // Anti-detection injection
    if (config.antiDetection) {
      if (useOrganic) {
        // Firefox: tam legacy script (stealth plugin desteklemiyor)
        await context.addInitScript(createFirefoxAntiDetectionScript(profile));
        dashboardState[sessionId].lastAction = "Anti-det (Firefox)";
      } else {
        // Chromium: stealth plugin otomatik + ek profil bazli script
        await context.addInitScript(createStealthCompatScript(profile));
        dashboardState[sessionId].lastAction = "Anti-det (Stealth+)";
      }
      renderDashboard();
    }

    // Referrer injection — SADECE referrer modunda
    if (!useOrganic && referrer) {
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
    // --- Organik veya direkt giriş ---
    if (useOrganic) {
      const query = pickRandom(organic.searchQueries);
      log(sessionId, `Organik arama basliyor: "${query}"`);
      await performGoogleOrganicSearch(page, context, sessionId, query);
    } else {
      // Direkt ziyaret - startUrls varsa rastgele birini sec
      const entryUrl = (config.startUrls && config.startUrls.length > 0)
        ? pickRandom(config.startUrls)
        : config.targetUrl;
      dashboardState[sessionId].lastAction = "Sayfa aciliyor";
      dashboardState[sessionId].currentUrl = entryUrl;
      renderDashboard();
      log(sessionId, `Giris sayfasi aciliyor: ${entryUrl}`);
      await page.goto(entryUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // Sayfa yuklenme sonrasi insan gibi bekleme
      await page.waitForTimeout(randomBetween(1000, 3000));
    }

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
        // Sayfa yuklenme sonrasi insan gibi bekleme
        await page.waitForTimeout(randomBetween(1000, 2500));
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
