import { createHash } from "node:crypto";
import type { ElementSnapshot } from "../types.js";

export function hashSnapshot(snapshot: Omit<ElementSnapshot, "hash">): string {
  const stableShape = [
    snapshot.tagName,
    snapshot.role ?? "",
    snapshot.label ?? "",
    snapshot.placeholder ?? "",
    snapshot.testId ?? "",
    snapshot.id ?? "",
    snapshot.name ?? "",
    snapshot.type ?? "",
    snapshot.text.slice(0, 80),
    snapshot.classes.slice(0, 4).join(".")
  ].join("|").toLowerCase();

  return createHash("sha256").update(stableShape).digest("hex").slice(0, 16);
}

export function pageKeyFromUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}
