import type { Page } from "@playwright/test";
import { hashSnapshot } from "./fingerprint.js";
import type { ElementSnapshot } from "../types.js";

type RawSnapshot = Omit<ElementSnapshot, "hash">;

export async function scanVisibleElements(page: Page): Promise<ElementSnapshot[]> {
  const raw = await page.evaluate<RawSnapshot[]>(`(() => {
    const selector = [
      "button",
      "a",
      "input",
      "textarea",
      "select",
      "[role]",
      "[data-testid]",
      "[data-test]",
      "[aria-label]"
    ].join(",");

    const cssPath = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? "#" + CSS.escape(current.id) : "";
        if (id) {
          parts.unshift(tag + id);
          break;
        }
        const parent = current.parentElement;
        const sameTagSiblings = parent
          ? Array.from(parent.children).filter((child) => child.tagName === current.tagName)
          : [];
        const nth = sameTagSiblings.length > 1 ? ":nth-of-type(" + (sameTagSiblings.indexOf(current) + 1) + ")" : "";
        parts.unshift(tag + nth);
        current = parent;
      }
      return parts.join(" > ");
    };

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(0, 250)
      .map((element) => {
        const htmlElement = element;
        const input = element;
        const ariaLabel = element.getAttribute("aria-label") ?? undefined;
        const dataTestId = element.getAttribute("data-testid") ?? element.getAttribute("data-test") ?? undefined;
        return {
          tagName: element.tagName.toLowerCase(),
          text: (htmlElement.innerText || input.value || ariaLabel || "").replace(/\s+/g, " ").trim(),
          role: element.getAttribute("role") ?? undefined,
          label: ariaLabel,
          placeholder: input.placeholder || undefined,
          testId: dataTestId,
          id: htmlElement.id || undefined,
          name: input.name || undefined,
          type: input.type || undefined,
          classes: Array.from(htmlElement.classList).slice(0, 6),
          cssPath: cssPath(element)
        };
      });
  })()`);

  return raw.map((snapshot) => ({ ...snapshot, hash: hashSnapshot(snapshot) }));
}
