import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { LocatorCacheEntry, LocatorCandidate } from "../types.js";

interface CacheFile {
  version: 1;
  entries: Record<string, LocatorCacheEntry>;
}

export class LocatorCache {
  private data: CacheFile = { version: 1, entries: {} };

  constructor(private readonly filePath = ".locator-cache.json") {
    this.load();
  }

  get(targetName: string, pageKey: string): LocatorCacheEntry | undefined {
    return this.data.entries[this.key(targetName, pageKey)];
  }

  recordSuccess(input: {
    targetName: string;
    pageKey: string;
    elementHash: string;
    candidates: LocatorCandidate[];
    candidate: LocatorCandidate;
    cacheHit: boolean;
    resolutionMs: number;
  }): LocatorCacheEntry {
    const key = this.key(input.targetName, input.pageKey);
    const existing = this.data.entries[key];
    const now = new Date().toISOString();
    const attempts = (existing?.attempts ?? 0) + 1;
    const successes = (existing?.successes ?? 0) + 1;
    const previousAvg = existing?.avgResolutionMs ?? input.resolutionMs;
    const avgResolutionMs = Math.round((previousAvg * (attempts - 1) + input.resolutionMs) / attempts);
    const startingConfidence = existing?.confidence ?? Math.min(input.candidate.score, 0.85);
    const confidence = Math.min(0.99, startingConfidence + (input.cacheHit ? 0.04 : 0.08));
    const candidates = this.mergeCandidates(input.candidate, input.candidates, existing?.candidates);

    const entry: LocatorCacheEntry = {
      targetName: input.targetName,
      pageKey: input.pageKey,
      elementHash: input.elementHash,
      candidates,
      confidence,
      attempts,
      successes,
      failures: existing?.failures ?? 0,
      cacheHits: (existing?.cacheHits ?? 0) + (input.cacheHit ? 1 : 0),
      cacheMisses: existing?.cacheMisses ?? 0,
      lastResolutionMs: input.resolutionMs,
      avgResolutionMs,
      lastSeenAt: now,
      updatedAt: now
    };
    this.data.entries[key] = entry;
    this.save();
    return entry;
  }

  recordMiss(targetName: string, pageKey: string): void {
    const key = this.key(targetName, pageKey);
    const existing = this.data.entries[key];
    if (!existing) return;
    existing.attempts += 1;
    existing.failures += 1;
    existing.cacheMisses += 1;
    existing.confidence = Math.max(0.05, existing.confidence - 0.12);
    existing.updatedAt = new Date().toISOString();
    this.save();
  }

  private mergeCandidates(
    winner: LocatorCandidate,
    generated: LocatorCandidate[],
    cached: LocatorCandidate[] = []
  ): LocatorCandidate[] {
    const ranked = [winner, ...cached, ...generated]
      .map((candidate) => ({
        ...candidate,
        score: candidate.strategy === winner.strategy && candidate.value === winner.value
          ? Math.min(0.99, Math.max(candidate.score, winner.score) + 0.06)
          : candidate.score
      }))
      .sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    return ranked.filter((candidate) => {
      const key = `${candidate.strategy}:${candidate.value}:${candidate.name ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    this.data = JSON.parse(readFileSync(this.filePath, "utf8")) as CacheFile;
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (dir !== ".") mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`);
  }

  private key(targetName: string, pageKey: string): string {
    return `${pageKey}::${targetName.toLowerCase().trim()}`;
  }
}
