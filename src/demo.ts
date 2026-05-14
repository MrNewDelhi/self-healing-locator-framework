import { chromium } from "@playwright/test";
import { LocatorCache, SelfHealingLocator } from "./index.js";
import type { LocatorCandidate } from "./types.js";

const brokenSeed: LocatorCandidate = {
  strategy: "css",
  value: "#login-button-before-cms-redesign",
  score: 0.2,
  reason: "Simulates a stale locator left behind after an unannounced page change."
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const cache = new LocatorCache(".locator-cache.json");
const healing = new SelfHealingLocator(page, { cache, timeoutMs: 1_200 });

await page.goto("https://www.saucedemo.com/", { waitUntil: "domcontentloaded" });
await page.getByPlaceholder("Username").fill("standard_user");
await page.getByPlaceholder("Password").fill("secret_sauce");

const login = await healing.find("login button", [brokenSeed]);
await login.locator.click();
await page.waitForURL(/inventory/);

console.log(JSON.stringify({
  target: "login button",
  cacheHit: login.cacheHit,
  healed: login.healed,
  selectedLocator: login.candidate,
  confidence: login.confidence,
  attempted: login.attemptedCandidates.length,
  resolutionMs: login.resolutionMs
}, null, 2));

await browser.close();
