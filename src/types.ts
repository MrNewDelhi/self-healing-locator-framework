import type { Locator, Page } from "@playwright/test";

export type LocatorStrategy = "role" | "text" | "label" | "placeholder" | "testId" | "css";

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  value: string;
  name?: string;
  score: number;
  reason: string;
}

export interface ElementSnapshot {
  tagName: string;
  text: string;
  role?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  id?: string;
  name?: string;
  type?: string;
  classes: string[];
  cssPath: string;
  hash: string;
}

export interface LocatorCacheEntry {
  targetName: string;
  pageKey: string;
  elementHash: string;
  candidates: LocatorCandidate[];
  confidence: number;
  attempts: number;
  successes: number;
  failures: number;
  cacheHits: number;
  cacheMisses: number;
  lastResolutionMs: number;
  avgResolutionMs: number;
  lastSeenAt: string;
  updatedAt: string;
}

export interface ResolutionResult {
  locator: Locator;
  candidate: LocatorCandidate;
  cacheHit: boolean;
  healed: boolean;
  confidence: number;
  attemptedCandidates: LocatorCandidate[];
  elementHash?: string;
  resolutionMs: number;
}

export interface LocatorGenerator {
  generate(input: {
    page: Page;
    targetName: string;
    snapshots: ElementSnapshot[];
  }): Promise<LocatorCandidate[]>;
}
