import type { Locator, Page } from "@playwright/test";
import { LocatorCache } from "./cache/LocatorCache.js";
import { pageKeyFromUrl } from "./dom/fingerprint.js";
import { scanVisibleElements } from "./dom/scanPage.js";
import { DeterministicLocatorGenerator, GeminiLocatorGenerator } from "./gemini/GeminiLocatorGenerator.js";
import type { LocatorCandidate, LocatorGenerator, ResolutionResult } from "./types.js";

export class SelfHealingLocator {
  constructor(
    private readonly page: Page,
    private readonly options: {
      cache?: LocatorCache;
      generator?: LocatorGenerator;
      timeoutMs?: number;
    } = {}
  ) {}

  async find(targetName: string, seedLocators: LocatorCandidate[] = []): Promise<ResolutionResult> {
    const startedAt = Date.now();
    const cache = this.options.cache ?? new LocatorCache();
    const generator = this.options.generator ?? new GeminiLocatorGenerator({
      fallback: new DeterministicLocatorGenerator()
    });
    const pageKey = pageKeyFromUrl(this.page.url());
    const cached = cache.get(targetName, pageKey);
    const attemptedCandidates: LocatorCandidate[] = [];

    for (const candidate of [...seedLocators, ...(cached?.candidates ?? [])].slice(0, 5)) {
      attemptedCandidates.push(candidate);
      const locator = this.materialize(candidate);
      if (await this.isUsable(locator)) {
        const elementHash = cached?.elementHash ?? "cache-hit-without-scan";
        const entry = cache.recordSuccess({
          targetName,
          pageKey,
          elementHash,
          candidates: cached?.candidates ?? seedLocators,
          candidate,
          cacheHit: Boolean(cached),
          resolutionMs: Date.now() - startedAt
        });
        return {
          locator,
          candidate,
          cacheHit: Boolean(cached),
          healed: false,
          confidence: entry.confidence,
          attemptedCandidates,
          elementHash,
          resolutionMs: Date.now() - startedAt
        };
      }
    }

    if (cached) cache.recordMiss(targetName, pageKey);

    const [snapshots, screenshotBuffer] = await Promise.all([
      scanVisibleElements(this.page),
      this.page.screenshot({ fullPage: false, type: "png" })
    ]);
    const generated = await generator.generate({
      page: this.page,
      targetName,
      snapshots,
      screenshot: {
        mimeType: "image/png",
        base64: screenshotBuffer.toString("base64"),
        source: "playwright"
      }
    });
    for (const candidate of generated) {
      attemptedCandidates.push(candidate);
      const locator = this.materialize(candidate);
      if (await this.isUsable(locator)) {
        const elementHash = this.hashForCandidate(candidate, snapshots);
        const entry = cache.recordSuccess({
          targetName,
          pageKey,
          elementHash,
          candidates: generated,
          candidate,
          cacheHit: false,
          resolutionMs: Date.now() - startedAt
        });
        return {
          locator,
          candidate,
          cacheHit: false,
          healed: true,
          confidence: entry.confidence,
          attemptedCandidates,
          elementHash,
          resolutionMs: Date.now() - startedAt
        };
      }
    }

    throw new Error(
      `Unable to resolve "${targetName}". Tried: ${attemptedCandidates
        .map((candidate) => `${candidate.strategy}:${candidate.value}`)
        .join(", ")}`
    );
  }

  materialize(candidate: LocatorCandidate): Locator {
    switch (candidate.strategy) {
      case "role":
        return this.page.getByRole(candidate.value as Parameters<Page["getByRole"]>[0], {
          name: candidate.name ? new RegExp(escapeRegExp(candidate.name), "i") : undefined
        });
      case "label":
        return this.page.getByLabel(new RegExp(escapeRegExp(candidate.value), "i"));
      case "placeholder":
        return this.page.getByPlaceholder(new RegExp(escapeRegExp(candidate.value), "i"));
      case "testId":
        return this.page.getByTestId(candidate.value);
      case "text":
        return this.page.getByText(new RegExp(escapeRegExp(candidate.value), "i"));
      case "css":
        return this.page.locator(candidate.value);
    }
  }

  private async isUsable(locator: Locator): Promise<boolean> {
    try {
      const first = locator.first();
      await first.waitFor({ state: "visible", timeout: this.options.timeoutMs ?? 1_500 });
      return (await first.count()) > 0;
    } catch {
      return false;
    }
  }

  private hashForCandidate(candidate: LocatorCandidate, snapshots: { cssPath: string; hash: string; id?: string; text?: string; testId?: string; label?: string; placeholder?: string }[]): string {
    const match = snapshots.find((snapshot) => {
      if (candidate.strategy === "css") {
        return snapshot.cssPath === candidate.value || (snapshot.id && candidate.value === `#${snapshot.id}`);
      }
      if (candidate.strategy === "testId") return snapshot.testId === candidate.value;
      if (candidate.strategy === "text") return snapshot.text === candidate.value;
      if (candidate.strategy === "label") return snapshot.label === candidate.value;
      if (candidate.strategy === "placeholder") return snapshot.placeholder === candidate.value;
      if (candidate.strategy === "role") return snapshot.text === candidate.name || snapshot.label === candidate.name;
      return false;
    });
    return match?.hash ?? "unknown";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
