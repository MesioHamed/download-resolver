// scripts/resolve_download.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function run() {
  const url = process.argv[2] || process.env.SHORT_LINK;
  if (!url) {
    console.error("Usage: node resolve_download.js <short-link>");
    process.exit(2);
  }

  await ensureDir('downloads');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Opening:", url);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.error("Error loading page:", e.message);
  }

  // Heuristic download selectors - adjustable per site
  const selectors = [
    'button:has-text("Download")',
    'a:has-text("Download")',
    'text=Download',
    'button[data-test="download-button"]',
    '.download-button',
    '#downloadButton',
    'a[href*="/download"]',
    'a:has-text("Save")'
  ];

  // Listen for "download" events
  let downloaded = null;
  page.on('download', async (download) => {
    const suggested = download.suggestedFilename() || 'file';
    const filepath = path.join('downloads', suggested);
    try {
      await download.saveAs(filepath);
      downloaded = filepath;
      console.log("SAVED_FILE:", filepath);
    } catch (e) {
      console.error("Download save error:", e.message);
    }
  });

  // Also inspect network responses for attachment content-disposition (fallback)
  page.on('response', async (response) => {
    try {
      const h = response.headers();
      if (h['content-disposition'] && /attachment/i.test(h['content-disposition'])) {
        const url = response.url();
        console.log("RESPONSE_ATTACHMENT_URL:", url);
      }
    } catch (e) {}
  });

  // Try clicking likely download buttons (first present)
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        console.log("Clicking selector:", sel);
        try {
          await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }).catch(()=>{}),
            el.click({ timeout: 10000 })
          ]);
        } catch (e) {
          // clicking may still trigger network flow, ignore errors
        }
        // small wait for download to start
        await page.waitForTimeout(3000);
        if (downloaded) break;
      }
    } catch (e) {
      // ignore selector errors
    }
  }

  // If no download event fired, try clicking "direct link" anchors
  if (!downloaded) {
    const anchors = await page.$$('a');
    for (const a of anchors.slice(0, 40)) {
      const href = await a.getAttribute('href');
      if (!href) continue;
      // quick heuristic: links that include "/download" or end with archive extension
      if (/\/download|\.zip$|\.rar$|\.tgz$|\.tar\.gz$/i.test(href)) {
        const abs = new URL(href, page.url()).toString();
        console.log("POTENTIAL_DIRECT_LINK:", abs);
      }
    }
  }

  // Final reporting
  if (downloaded) {
    console.log("RESULT: SUCCESS", downloaded);
    await browser.close();
    process.exit(0);
  } else {
    console.log("RESULT: NO_FILE_FOUND");
    await browser.close();
    process.exit(3);
  }
}

run();
