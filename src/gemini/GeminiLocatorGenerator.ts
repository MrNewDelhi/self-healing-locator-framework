import { GoogleGenAI, Type } from "@google/genai";
import type { ElementSnapshot, LocatorCandidate, LocatorGenerator, VisualContext } from "../types.js";

interface GeminiLocatorGeneratorOptions {
  apiKey?: string;
  textModel?: string;
  visionModel?: string;
  maxSnapshots?: number;
  fallback?: LocatorGenerator;
}

export class GeminiLocatorGenerator implements LocatorGenerator {
  private readonly ai?: GoogleGenAI;
  private readonly textModel: string;
  private readonly visionModel: string;
  private readonly maxSnapshots: number;

  constructor(private readonly options: GeminiLocatorGeneratorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    this.ai = apiKey ? new GoogleGenAI({ apiKey }) : undefined;
    this.textModel = options.textModel ?? process.env.GEMINI_TEXT_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash";
    this.visionModel = options.visionModel ?? process.env.GEMINI_VISION_MODEL ?? "gemini-3.1-pro";
    this.maxSnapshots = options.maxSnapshots ?? 80;
  }

  async generate(input: {
    targetName: string;
    snapshots: ElementSnapshot[];
    screenshot?: VisualContext;
  }): Promise<LocatorCandidate[]> {
    if (!this.ai) {
      if (this.options.fallback) return this.options.fallback.generate(input);
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required to generate self-healing locator candidates.");
    }

    const snapshots = input.snapshots
      .slice(0, this.maxSnapshots)
      .map((snapshot) => ({
        hash: snapshot.hash,
        tagName: snapshot.tagName,
        text: snapshot.text,
        role: snapshot.role,
        label: snapshot.label,
        placeholder: snapshot.placeholder,
        testId: snapshot.testId,
        id: snapshot.id,
        name: snapshot.name,
        type: snapshot.type,
        classes: snapshot.classes,
        cssPath: snapshot.cssPath
      }));

    const textCandidates = await this.generateWithModel({
      model: this.textModel,
      targetName: input.targetName,
      snapshots
    });

    if (textCandidates.length > 0 || !input.screenshot) return textCandidates;

    return this.generateWithModel({
      model: this.visionModel,
      targetName: input.targetName,
      snapshots,
      screenshot: input.screenshot
    });
  }

  private async generateWithModel(input: {
    model: string;
    targetName: string;
    snapshots: Pick<ElementSnapshot, "hash" | "tagName" | "text" | "role" | "label" | "placeholder" | "testId" | "id" | "name" | "type" | "classes" | "cssPath">[];
    screenshot?: VisualContext;
  }): Promise<LocatorCandidate[]> {
    if (!this.ai) throw new Error("Gemini client is not configured.");

    const parts = [
      {
        text: [
          "You are a QA automation locator generator.",
          "Given a target element name and compact visible DOM/accessibility snapshots, return exactly the top 5 locator candidates.",
          "If a screenshot is attached, use it only as visual context to disambiguate placement, labels, and visible intent.",
          "Prefer stable, human-meaningful locators in this order: testId, role, label, placeholder, text, css.",
          "Return only valid JSON matching the schema. Do not include markdown.",
          "",
          `Target element: ${input.targetName}`,
          "",
          `Snapshots: ${JSON.stringify(input.snapshots)}`
        ].join("\n")
      },
      ...(input.screenshot
        ? [
            {
              inlineData: {
                mimeType: input.screenshot.mimeType,
                data: input.screenshot.base64
              }
            }
          ]
        : [])
    ];

    const response = await this.ai.models.generateContent({
      model: input.model,
      contents: [
        {
          role: "user",
          parts
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          minItems: 1,
          maxItems: 5,
          items: {
            type: Type.OBJECT,
            required: ["strategy", "value", "score", "reason"],
            properties: {
              strategy: {
                type: Type.STRING,
                enum: ["role", "text", "label", "placeholder", "testId", "css"]
              },
              value: { type: Type.STRING },
              name: { type: Type.STRING },
              score: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            }
          }
        }
      }
    });

    return normalizeCandidates(JSON.parse(response.text ?? "[]"));
  }
}

export class DeterministicLocatorGenerator implements LocatorGenerator {
  async generate(input: { targetName: string; snapshots: ElementSnapshot[] }): Promise<LocatorCandidate[]> {
    const target = normalize(input.targetName);
    const scored = input.snapshots
      .map((snapshot) => ({ snapshot, affinity: affinity(target, snapshot) }))
      .filter(({ affinity }) => affinity > 0)
      .sort((a, b) => b.affinity - a.affinity);

    const candidates: LocatorCandidate[] = [];
    for (const { snapshot, affinity: base } of scored) {
      if (snapshot.testId) {
        candidates.push({
          strategy: "testId",
          value: snapshot.testId,
          score: clamp(base + 0.2),
          reason: "Stable test id/data-test matched the target."
        });
      }
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
          reason: "CSS path is a structural fallback."
        });
      }
      if (candidates.length >= 12) break;
    }

    return dedupe(candidates).sort((a, b) => b.score - a.score).slice(0, 5);
  }
}

function normalizeCandidates(value: unknown): LocatorCandidate[] {
  if (!Array.isArray(value)) return [];
  return dedupe(
    value
      .filter((candidate): candidate is LocatorCandidate => {
        if (!candidate || typeof candidate !== "object") return false;
        const raw = candidate as Partial<LocatorCandidate>;
        return Boolean(raw.strategy && raw.value && typeof raw.score === "number" && raw.reason);
      })
      .map((candidate) => ({
        strategy: candidate.strategy,
        value: candidate.value,
        name: candidate.name,
        score: clamp(candidate.score),
        reason: candidate.reason
      }))
  )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
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
