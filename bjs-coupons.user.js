// ==UserScript==
// @name         BJ's Coupon Clipper
// @namespace    https://www.bjs.com/
// @version      2.0.1
// @description  Clip available BJ's coupons sequentially and verify each result.
// @homepageURL  https://github.com/fenerty/bjs-coupon-clipper
// @downloadURL  https://raw.githubusercontent.com/fenerty/bjs-coupon-clipper/main/bjs-coupons.user.js
// @updateURL    https://raw.githubusercontent.com/fenerty/bjs-coupon-clipper/main/bjs-coupons.user.js
// @match        *://www.bjs.com/myCoupons*
// @match        *://bjs.com/myCoupons*
// @match        *://www.bjs.com/account/myCoupons*
// @match        *://bjs.com/account/myCoupons*
// @match        *://www.bjs.com/coupons*
// @match        *://bjs.com/coupons*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  if (window.__bjsCouponClipperV2) return;
  window.__bjsCouponClipperV2 = true;

  const CONFIG = {
    minClickIntervalMs: 450,
    confirmationTimeoutMs: 8000,
    scanSettleMs: 250,
    stableScanPasses: 3,
    maxScrollPasses: 40,
  };
  const SELECTORS = {
    clip: 'button[name="clipToCard"], [data-auto-data="coupon_ClipToCard"], [data-testid="coupon-btn"]',
    card: '[data-index^="card-"], [id^="card-"]',
    badge: '[data-testid="clipped-badge"], [data-testid="clipped-badge-mobile"], .clipped-text',
    available: '[data-testid="tab-available"], [data-auto-data="coupon_availableTab"]',
    clipped: '[data-testid="tab-activated"], [data-auto-data="coupon_clippedTab"]',
    description: '[data-testid="offer-description"], [data-auto-data="coupon_OfferDescription"]',
    summary: '[data-testid="offer-summary"], [data-auto-data="coupon_OfferSummary"]',
    expiry: '[data-testid="coupon-datetime"], [data-auto-data="coupon_ExpDate"]',
  };
  const OVERLAY_ID = "bjs-coupon-clipper-overlay";
  const IGNORE_SELECTOR = "#" + OVERLAY_ID + ', [data-bjs-clipper-ignore="true"]';
  const STATE = {
    running: false, stopRequested: false, found: 0, clicked: 0,
    skipped: 0, failed: 0, remaining: 0, status: "Ready", logLines: [],
  };
  let panel = null;

  const text = (value) => (value || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isCouponPage = () => /^\/(?:account\/)?(?:myCoupons|coupons)(?:\/|$)/i.test(location.pathname);
  const isIgnored = (node) => !!node.closest(IGNORE_SELECTOR);

  function isVisible(node) {
    if (!node || !node.isConnected || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  }

  function isEnabled(node) {
    return !node.disabled && node.getAttribute("aria-disabled") !== "true" && node.getAttribute("aria-busy") !== "true";
  }

  function isClipLabel(value) {
    return /^(?:[+\u2702\uFE0F]\s*)*clip(?:\s+to\s+card)?$/i.test(text(value));
  }

  function isClipControl(node) {
    return [node.textContent, node.getAttribute("aria-label"), node.value].some(isClipLabel);
  }

  function hasClippedBadge(card) {
    return !!card && Array.from(card.querySelectorAll(SELECTORS.badge)).some((node) => /^clipped$/i.test(text(node.textContent)));
  }

  function clipCandidates() {
    const main = document.querySelector("main") || document.body;
    if (!main) return [];
    const nodes = Array.from(main.querySelectorAll(SELECTORS.clip + ', button, [role="button"], a, input[type="button"], input[type="submit"]'))
      .filter((node) => !isIgnored(node) && isVisible(node) && isClipControl(node) && !hasClippedBadge(node.closest(SELECTORS.card)));
    // A role=button wrapper and its nested button represent one action.
    return nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)))
      .map((node) => ({ node, card: node.closest(SELECTORS.card) }));
  }

  function pageCouponCount() {
    const main = document.querySelector("main") || document.body;
    if (!main) return null;
    for (const node of main.querySelectorAll("li, p, span")) {
      if (isIgnored(node)) continue;
      const match = text(node.textContent).match(/^showing\s*([\d,]+)\s*coupons?$/i);
      if (match) return Number(match[1].replace(/,/g, ""));
    }
    return null;
  }

  function clippedCount() {
    const match = text(document.querySelector(SELECTORS.clipped)?.textContent).match(/\(([\d,]+)\)/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  }

  function cardDetails(card) {
    if (!card) return "";
    return JSON.stringify([SELECTORS.summary, SELECTORS.description, SELECTORS.expiry]
      .map((selector) => text(card.querySelector(selector)?.textContent)));
  }

  function freshCard(candidate, details) {
    if (candidate.card?.isConnected && cardDetails(candidate.card) === details) return candidate.card;
    const id = candidate.card?.id;
    const replacement = id ? document.getElementById(id) : null;
    return replacement && cardDetails(replacement) === details ? replacement : null;
  }

  function assertPageReady(checkAvailable = true) {
    if (!isCouponPage()) throw new Error("The browser left the coupons page.");
    const tab = document.querySelector(SELECTORS.available);
    if (checkAvailable && tab && !tab.classList.contains("tab-active") && tab.getAttribute("aria-selected") !== "true") {
      throw new Error("The Available tab changed. Return to Available and start again.");
    }
    const main = document.querySelector("main") || document.body;
    const password = document.querySelector('input[type="password"]');
    if (password && isVisible(password)) throw new Error("Sign in to BJ's, then start again.");
    const warnings = Array.from(main.querySelectorAll('[role="alert"], [role="dialog"]'))
      .filter((node) => !isIgnored(node) && isVisible(node)).map((node) => text(node.textContent));
    const blocking = warnings.find((value) => /too many requests|rate limit|try again later|access denied|verify.*human|unable to clip|failed to clip/i.test(value));
    if (blocking) throw new Error("BJ's stopped the request: " + blocking.slice(0, 180));
  }

  function log(message) {
    const line = "[" + new Date().toISOString() + "] [BJ's Clipper] " + message;
    STATE.logLines.push(line);
    console.log(line);
    if (panel?.log) panel.log.textContent = STATE.logLines.slice(-8).join("\n");
  }

  function updatePanel(status = STATE.status) {
    STATE.status = status;
    if (!panel) return;
    panel.stats.textContent = "found=" + STATE.found + " clicked=" + STATE.clicked + " skipped=" + STATE.skipped + " failed=" + STATE.failed;
    panel.status.textContent = status + (STATE.running ? " | " + STATE.remaining + " remaining" : "");
    panel.run.disabled = STATE.running;
    panel.stop.disabled = !STATE.running || STATE.stopRequested;
  }

  function recordScan(candidates) {
    STATE.remaining = candidates.length;
    // Scan before a click or after confirmation to avoid double-counting an in-flight control.
    STATE.found = Math.max(STATE.found, STATE.clicked + STATE.skipped + candidates.length);
    updatePanel();
  }

  async function waitFor(check, timeoutMs, allowStop = true) {
    return new Promise((resolve, reject) => {
      let timer;
      let activeMs = 0;
      let lastCheck = performance.now();
      let wasHidden = document.hidden;
      let settled = false;
      const observer = new MutationObserver(poll);
      function finish(value, error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        document.removeEventListener("visibilitychange", poll);
        if (error) reject(error); else resolve(value);
      }
      function poll() {
        if (settled) return;
        clearTimeout(timer);
        const now = performance.now();
        if (!wasHidden && !document.hidden) activeMs += now - lastCheck;
        lastCheck = now;
        wasHidden = document.hidden;
        try {
          const value = check();
          if (value) return finish(value);
          if (allowStop && STATE.stopRequested) return finish(null);
          if (activeMs >= timeoutMs) return finish(null);
        } catch (error) { return finish(null, error); }
        timer = setTimeout(poll, 100);
      }
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      document.addEventListener("visibilitychange", poll);
      poll();
    });
  }

  async function waitForForeground(checkAvailable = true) {
    if (STATE.stopRequested) return false;
    if (document.hidden) {
      updatePanel("Paused: return to this tab to continue");
      await waitFor(() => !document.hidden, Number.POSITIVE_INFINITY);
    }
    if (STATE.stopRequested) return false;
    assertPageReady(checkAvailable);
    updatePanel("Clipping");
    return true;
  }

  async function openAvailable() {
    const tab = document.querySelector(SELECTORS.available);
    if (tab) {
      if (tab.classList.contains("tab-active") || tab.getAttribute("aria-selected") === "true") return;
      tab.click();
      const ready = await waitFor(() => {
        const current = document.querySelector(SELECTORS.available);
        return current?.classList.contains("tab-active") || current?.getAttribute("aria-selected") === "true";
      }, 5000);
      if (!ready && !STATE.stopRequested) throw new Error("The Available tab did not load.");
      return;
    }
    const control = Array.from(document.querySelectorAll('main [role="tab"], main li, main a, main button'))
      .find((node) => !isIgnored(node) && isVisible(node) && /^available$/i.test(text(node.textContent)));
    if (control) { control.click(); await sleep(CONFIG.scanSettleMs); }
    if (!control && !clipCandidates().length && pageCouponCount() === null) {
      throw new Error("Could not find the coupons view. Check that you are signed in.");
    }
  }

  async function loadCoupons() {
    let previous = "";
    let stable = 0;
    for (let pass = 1; pass <= CONFIG.maxScrollPasses; pass += 1) {
      if (!(await waitForForeground())) return;
      updatePanel("Checking for more coupons");
      const candidates = clipCandidates();
      recordScan(candidates);
      const reported = pageCouponCount();
      const main = document.querySelector("main") || document.body;
      const cards = Array.from(main.querySelectorAll(SELECTORS.card)).filter(isVisible);
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      log("Scan " + pass + ": buttons=" + candidates.length + ", page=" + (reported ?? "?") + ", cards=" + cards.length + ".");
      if (reported !== null && cards.length >= reported) return;
      const snapshot = height + ":" + candidates.length + ":" + cards.length;
      stable = snapshot === previous ? stable + 1 : 0;
      if (stable >= CONFIG.stableScanPasses) return;
      previous = snapshot;
      window.scrollTo({ top: height, behavior: "instant" });
      await sleep(CONFIG.scanSettleMs);
    }
    throw new Error("Coupon loading did not settle. Stop and check the page before retrying.");
  }

  async function clipAll() {
    let lastClickAt = Number.NEGATIVE_INFINITY;
    let emptyPass = false;
    let stalePasses = 0;
    while (await waitForForeground()) {
      const candidates = clipCandidates();
      recordScan(candidates);
      if (!candidates.length) {
        if (emptyPass) return;
        emptyPass = true;
        await loadCoupons();
        await sleep(CONFIG.scanSettleMs);
        continue;
      }
      emptyPass = false;
      const candidate = candidates[0];
      const details = cardDetails(candidate.card);
      const label = text(candidate.card?.querySelector(SELECTORS.description)?.textContent) || text(candidate.node.textContent);
      const delay = CONFIG.minClickIntervalMs - (performance.now() - lastClickAt);
      if (delay > 0) await sleep(delay);
      if (!(await waitForForeground())) return;
      if (!candidate.node.isConnected || !isVisible(candidate.node) || !isClipControl(candidate.node) || hasClippedBadge(candidate.card)) {
        if (hasClippedBadge(freshCard(candidate, details))) {
          STATE.skipped += 1;
          log("Skipped: already clipped before our click: " + label);
        } else if (++stalePasses >= 10) {
          throw new Error("The coupon list keeps changing. Let the page settle, then start again.");
        }
        continue;
      }
      const enabled = await waitFor(() => !candidate.node.isConnected || isEnabled(candidate.node), CONFIG.confirmationTimeoutMs);
      if (STATE.stopRequested) return;
      if (!candidate.node.isConnected) continue;
      if (!enabled) throw new Error("The next coupon is disabled or still loading. Try again after it settles.");
      if (!(await waitForForeground())) return;
      const beforeCount = clippedCount();
      lastClickAt = performance.now();
      stalePasses = 0;
      try {
        candidate.node.click();
        const confirmed = await waitFor(() => {
          assertPageReady();
          const card = freshCard(candidate, details);
          if (hasClippedBadge(card)) return true;
          const count = clippedCount();
          const controlGone = !candidate.node.isConnected || !isClipControl(candidate.node);
          return controlGone && beforeCount !== null && count !== null && count > beforeCount;
        }, CONFIG.confirmationTimeoutMs, false);
        if (!confirmed) throw new Error("BJ's did not confirm the clip. Stopping to avoid duplicate requests.");
        STATE.clicked += 1;
        log("Confirmed #" + STATE.clicked + " (" + Math.round(performance.now() - lastClickAt) + " ms): " + label);
        recordScan(clipCandidates());
      } catch (error) {
        STATE.failed += 1;
        updatePanel();
        throw error;
      }
    }
  }

  async function run() {
    if (STATE.running || !isCouponPage()) return;
    Object.assign(STATE, { running: true, stopRequested: false, found: 0, clicked: 0, skipped: 0, failed: 0, remaining: 0, logLines: [] });
    const start = performance.now();
    updatePanel("Starting");
    log("Version 2.0.1; sequential clips; minimum interval 450 ms; success requires confirmation.");
    try {
      if (await waitForForeground(false)) {
        await openAvailable();
        await loadCoupons();
        await clipAll();
      }
      updatePanel(STATE.stopRequested ? "Stopped by you" : "Finished");
    } catch (error) {
      updatePanel("Stopped: check the log");
      log("Stopped: " + (error.message || String(error)));
    } finally {
      STATE.running = false;
      STATE.remaining = clipCandidates().length;
      updatePanel();
      log(STATE.status + ". found=" + STATE.found + " clicked=" + STATE.clicked + " skipped=" + STATE.skipped + " failed=" + STATE.failed + " remaining=" + STATE.remaining + " elapsed=" + ((performance.now() - start) / 1000).toFixed(1) + "s");
    }
  }

  function downloadLogs() {
    const blob = new Blob([STATE.logLines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bjs-coupon-clipper-" + Date.now() + ".log";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function injectPanel() {
    if (!document.body) return;
    if (!isCouponPage()) {
      document.getElementById(OVERLAY_ID)?.remove();
      if (STATE.running) STATE.stopRequested = true;
      panel = null;
      return;
    }
    if (document.getElementById(OVERLAY_ID)) return;
    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.dataset.bjsClipperIgnore = "true";
    root.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:370px;max-width:calc(100vw - 32px);box-sizing:border-box;background:#191e27;color:#f9fafb;border:1px solid #424751;border-radius:12px;box-shadow:0 16px 40px #0005;padding:12px;font:13px/1.4 'Segoe UI',sans-serif";
    const title = document.createElement("strong");
    title.textContent = "BJ's Coupon Clipper 2.0";
    const stats = document.createElement("div");
    stats.dataset.role = "stats";
    stats.style.cssText = "margin-top:8px;color:#d1d5db";
    const status = document.createElement("div");
    status.dataset.role = "status";
    status.style.cssText = "margin:6px 0 10px;color:#d1d5db";
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:6px;margin-bottom:8px";
    function button(label, handler, color) {
      const node = document.createElement("button");
      node.type = "button";
      node.textContent = label;
      node.style.cssText = "padding:8px;border:0;border-radius:6px;background:" + color + ";color:#fff;cursor:pointer;font:inherit";
      node.addEventListener("click", handler);
      buttons.appendChild(node);
      return node;
    }
    const startButton = button("Clip Coupons", run, "#bf0035");
    startButton.style.flex = "1";
    const stopButton = button("Stop", () => { STATE.stopRequested = true; updatePanel("Stopping after the current request"); }, "#414957");
    button("Download Log", downloadLogs, "#414957");
    const logBox = document.createElement("pre");
    logBox.dataset.role = "log";
    logBox.style.cssText = "margin:0;max-height:170px;overflow:auto;white-space:pre-wrap;color:#e5e7eb;background:#ffffff08;border-radius:6px;padding:8px;font:11px/1.5 Consolas,monospace";
    root.append(title, stats, status, buttons, logBox);
    document.body.appendChild(root);
    panel = { root, stats, status, log: logBox, run: startButton, stop: stopButton };
    updatePanel();
    logBox.textContent = STATE.logLines.slice(-8).join("\n") || "Ready. Sign in and choose Clip Coupons.";
  }

  injectPanel();
  setInterval(injectPanel, 1000);
  document.addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === "b" && !event.target.matches('input, textarea, [contenteditable="true"]')) {
      event.preventDefault();
      run();
    }
  });
})();
