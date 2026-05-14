import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocatorCache, SelfHealingLocator } from "../src/index.js";
import type { LocatorCandidate } from "../src/types.js";

test("heals a stale login button locator on a black-box website", async ({ page }) => {
  const cacheDir = mkdtempSync(join(tmpdir(), "locator-cache-"));
  const cache = new LocatorCache(join(cacheDir, "cache.json"));
  const healing = new SelfHealingLocator(page, { cache, timeoutMs: 1_000 });
  const staleLocator: LocatorCandidate = {
    strategy: "css",
    value: "#login-button-before-client-cms-change",
    score: 0.1,
    reason: "Broken seed locator to force the healing pipeline."
  };

  await page.goto("/");
  await page.getByPlaceholder("Username").fill("standard_user");
  await page.getByPlaceholder("Password").fill("secret_sauce");

  const resolved = await healing.find("login button", [staleLocator]);
  await resolved.locator.click();

  await expect(page).toHaveURL(/inventory/);
  expect(resolved.cacheHit).toBe(false);
  expect(resolved.healed).toBe(true);
  expect(resolved.candidate.strategy).toMatch(/role|css|testId|text/);
  expect(resolved.confidence).toBeGreaterThan(0.5);

  rmSync(cacheDir, { recursive: true, force: true });
});

test("uses cache on the second lookup and raises confidence", async ({ page }) => {
  const cacheDir = mkdtempSync(join(tmpdir(), "locator-cache-"));
  const cache = new LocatorCache(join(cacheDir, "cache.json"));
  const firstPass = new SelfHealingLocator(page, { cache, timeoutMs: 1_000 });

  await page.goto("/");
  const first = await firstPass.find("login button");

  await page.reload();
  const secondPass = new SelfHealingLocator(page, { cache, timeoutMs: 1_000 });
  const second = await secondPass.find("login button");

  expect(first.healed).toBe(true);
  expect(second.cacheHit).toBe(true);
  expect(second.confidence).toBeGreaterThan(first.confidence);

  rmSync(cacheDir, { recursive: true, force: true });
});
