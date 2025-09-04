// scripts/resolve_download.js
// Robust resolver that actively finds & clicks download buttons (site-specific + fallbacks)
// Writes debug/page.html, debug/page.png, debug/network_log.json, debug/candidate_anchors.json
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function writeFile(p, data) { fs.writeFileSync(p, data, { encoding: 'utf8' }); console.log('WROTE:', p); }

async function clickIfExists(frame, selector) {
  try {
    const el = await frame.$(selector);
    if (!el) return false;
    await el.scrollIntoViewIfNeeded?.();
    try {
      // try to click normally and wait for download signal in caller
      await el.click({ timeout: 8000 }).catch(()=>{});
      return true;
    } catch (e) {
      // fallback: click via evaluate (useful for hidden/shadow elements)
      await frame.evaluate((s) => {
        const el = document.querySelector(s);
        if (el) {
          el.click();
        }
      }, selector).catch(()=>{});
      return true;
    }
  } catch (e) {
    return false;
  }
}

async function clickByText(frame, textRegex) {
  try {
    const handles = await frame.$$('button, a, div, span');
    for (const h of handles) {
      try {
        const inner = (await h.innerText()).trim();
        if (!inner) continue;
        if (textRegex.test(inner)) {
          await h.scrollIntoViewIfNeeded?.();
          await Promise.resolve(h.click()).catch(()=>{});
          return true;
        }
      } catch (e) {}
    }
  } catch (e) {}
  // fallback: evaluate find + click
  try {
    const clicked = await frame.evaluate((re) => {
      const regex = new RegExp(re, 'i');
      const tags = Array.from(document.querySelectorAll('button,a,div,span'));
      for (const el of tags) {
        try {
          if (regex.test(el.innerText || '')) { el.click(); return true; }
        } catch(e) {}
      }
      return false;
    }, textRegex.source);
    return !!clicked;
  } catch (e) { return false; }
}

async function tryCookieAccept(frame) {
  const acceptTexts = [/accept/i, /agree/i, /agree and continue/i, /accept all/i, /i agree/i];
  for (const r of acceptTexts) {
    const ok = await clickByText(frame, r);
    if (ok) {
      console.log('Clicked cookie/consent by text:', r);
      await frame.waitForTimeout(1000);
      return true;
    }
  }
  // also try typical selectors
  const selectors = ['button[id*="accept"]','button[class*="accept"]','button[class*="agree"]','button[aria-label*="accept"]'];
  for (const s of selectors) {
    if (await clickIfExists(frame, s)) { console.log('Clicked cookie selector:', s); await frame.waitForTimeout(800); return true; }
  }
  return false;
}

async function tryClickDownload(frame, hostname) {
  // site-specific preferred selectors
  if (/fromsmash/i.test(hostname)) {
    const fromSmashSelectors = [
      'button:has-text("Download")',
      'button:has-text("Download file")',
      'a.download',
      'a[href*="/download"]'
    ];
    for (const s of fromSmashSelectors) i
