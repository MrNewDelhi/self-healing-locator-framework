import type { ElementSnapshot, LocatorCandidate, LocatorGenerator } from "../types.js";

export class HeuristicLocatorGenerator implements LocatorGenerator {
  async generate(input: { targetName: string; snapshots: ElementSnapshot[] }): Promise<LocatorCandidate[]> {
    const target = normalize(input.targetName);
    const scored = input.snapshots
      .map((snapshot) => ({ snapshot, affinity: affinity(target, snapshot) }))
      .filter(({ affinity }) => affinity > 0)
      .sort((a, b) => b.affinity - a.affinity);

    const candidates: LocatorCandidate[] = [];
    for (const { snapshot, affinity: base } of scored) {
      if (snapshot.role || snapshot.tagName === "button") {
        const role = snapshot.role || "button";
        const name = snapshot.text || snapshot.label;
        if (name) {
          candidates.push({
            strategy: "role",
            value: role,
            name,
            score: clamp(base + 0.12),
            reason: `Accessible ${role} matched the target intent.`
          });
        }
      }
      if (snapshot.label) {
        candidates.push({
          strategy: "label",
          value: snapshot.label,
          score: clamp(base + 0.1),
          reason: "ARIA label is stable and user-facing."
        });
      }
      if (snapshot.placeholder) {
        candidates.push({
          strategy: "placeholder",
          value: snapshot.placeholder,
          score: clamp(base + 0.08),
          reason: "Placeholder text matched the requested element."
        });
      }
      if (snapshot.testId) {
        candidates.push({
          strategy: "testId",
          value: snapshot.testId,
          score: clamp(base + 0.2),
          reason: "Test id/data-test is usually the most stable black-box hook."
        });
      }
      if (snapshot.text && snapshot.tagName !== "input") {
        candidates.push({
          strategy: "text",
          value: snapshot.text,
          score: clamp(base),
          reason: "Visible text is available as a fallback locator."
        });
      }
      if (snapshot.id) {
        candidates.push({
          strategy: "css",
          value: `#${cssEscape(snapshot.id)}`,
          score: clamp(base + 0.06),
          reason: "Element id was present in the scanned component."
        });
      } else if (snapshot.cssPath) {
        candidates.push({
          strategy: "css",
          value: snapshot.cssPath,
          score: clamp(base - 0.15),
          reason: "CSS path is a last-resort structural fallback."
        });
      }
      if (candidates.length >= 12) break;
    }

    return dedupe(candidates).sort((a, b) => b.score - a.score).slice(0, 5);
  }
}

function affinity(target: string, snapshot: ElementSnapshot): number {
  const haystacks = [
    snapshot.text,
    snapshot.label,
    snapshot.placeholder,
    snapshot.testId,
    snapshot.id,
    snapshot.name,
    snapshot.type,
    snapshot.role,
    snapshot.classes.join(" ")
  ].filter(Boolean).map((value) => normalize(value ?? ""));

  const targetTokens = new Set(target.split(" ").filter(Boolean));
  let best = 0;
  for (const haystack of haystacks) {
    if (!haystack) continue;
    if (haystack === target) best = Math.max(best, 0.86);
    if (haystack.includes(target) || target.includes(haystack)) best = Math.max(best, 0.72);
    const overlap = haystack.split(" ").filter((token) => targetTokens.has(token)).length;
    if (overlap > 0) best = Math.max(best, 0.45 + overlap * 0.12);
  }
  return clamp(best);
}

function normalize(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clamp(value: number): number {
  return Math.max(0.05, Math.min(0.99, Number(value.toFixed(2))));
}

function dedupe(candidates: LocatorCandidate[]): LocatorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.strategy}:${candidate.value}:${candidate.name ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cssEscape(value: string): string {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
