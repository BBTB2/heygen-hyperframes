/**
 * Same-origin iframe PreviewAdapter — WS-A1 (hit-test + selection).
 *
 * Requirements:
 * - The iframe MUST be same-origin (srcdoc / blob URL). Cross-origin access to
 *   contentDocument throws a DOMException; this adapter does not guard that —
 *   the caller is responsible for ensuring same-origin.
 * - applyDraft / commitPreview / cancelPreview are WS-A2 scope — stubbed here.
 */

import type { PreviewAdapter, ElementAtPointResult, DraftProps } from "./types.js";

// ─── Pure resolver (testable without a browser) ───────────────────────────────

/**
 * Walk from `el` upward through parentElement, looking for the nearest node
 * that carries `[data-hf-id]` and is NOT `[data-hf-root]`.
 *
 * Returns null when:
 * - The walk exits the tree without finding `[data-hf-id]`
 * - The matching node is `[data-hf-root]` (transparent to hit-testing)
 * - `isVisible(node)` returns false for the matching node
 *
 * Keeping this a pure function (no elementFromPoint, no window access) makes
 * it unit-testable in a plain Node environment.
 */
export function resolveNearestHfElement(
  el: Element | null,
  isVisible: (el: Element) => boolean,
): ElementAtPointResult | null {
  let node = el;
  while (node !== null) {
    const id = node.getAttribute("data-hf-id");
    if (id !== null) {
      if (node.hasAttribute("data-hf-root")) return null;
      if (!isVisible(node)) return null;
      return { id, tag: node.tagName.toLowerCase() };
    }
    node = node.parentElement;
  }
  return null;
}

// ─── Visibility check ─────────────────────────────────────────────────────────

/**
 * Returns true when no element in the ancestor chain (inclusive) has
 * computed opacity === 0. Checks ancestors because a parent at opacity:0
 * makes the child invisible even if the child's own opacity is 1.
 *
 * This reflects the current GSAP timeline state (whatever the player has
 * seeked to). For atTime values matching the live playhead this is always
 * accurate. For speculative times this is NOT seeked — WS-A1 does not mutate
 * the timeline; accurate out-of-band opacity queries are WS-G follow-on.
 */
function isOpacityVisible(el: Element, win: Window & typeof globalThis): boolean {
  let node: Element | null = el;
  while (node !== null) {
    const style = win.getComputedStyle(node);
    if (parseFloat(style.opacity) === 0) return false;
    node = node.parentElement;
  }
  return true;
}

// ─── IframePreviewAdapter ─────────────────────────────────────────────────────

type SelectionHandler = (ids: string[]) => void;

class IframePreviewAdapter implements PreviewAdapter {
  private readonly iframe: HTMLIFrameElement;
  private _selection: string[] = [];
  private _handlers: SelectionHandler[] = [];

  constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe;
  }

  /**
   * Synchronous hit-test. Returns the nearest `[data-hf-id]` element under
   * (x, y) in the iframe's coordinate space, or null for a transparent hit
   * (root, opacity-0, or nothing at all).
   *
   * atTime: reflects the GSAP state at the playhead when this is called.
   * Seeking to a different time to check visibility is WS-G scope.
   */
  elementAtPoint(x: number, y: number, _opts?: { atTime?: number }): ElementAtPointResult | null {
    const doc = this.iframe.contentDocument;
    if (!doc) return null;
    const win = this.iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!win) return null;

    const hit = doc.elementFromPoint(x, y);
    return resolveNearestHfElement(hit, (el) => isOpacityVisible(el, win));
  }

  // WS-A2 stubs — commitPreview / applyDraft derive the moveElement op --------

  applyDraft(_id: string, _props: DraftProps): void {}

  commitPreview(): void {}

  cancelPreview(): void {}

  // Selection -----------------------------------------------------------------

  select(ids: string[], opts?: { additive?: boolean }): void {
    if (opts?.additive) {
      const merged = new Set([...this._selection, ...ids]);
      this._selection = [...merged];
    } else {
      this._selection = [...ids];
    }
    this._emit();
  }

  on(event: "selection", handler: SelectionHandler): () => void {
    if (event !== "selection") return () => {};
    this._handlers.push(handler);
    return () => {
      this._handlers = this._handlers.filter((h) => h !== handler);
    };
  }

  private _emit(): void {
    const ids = [...this._selection];
    for (const h of this._handlers) h(ids);
  }
}

export function createIframePreviewAdapter(iframe: HTMLIFrameElement): PreviewAdapter {
  return new IframePreviewAdapter(iframe);
}
