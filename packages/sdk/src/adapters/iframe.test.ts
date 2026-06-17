/**
 * Unit tests for resolveNearestHfElement (pure resolver — no browser needed).
 *
 * elementFromPoint itself requires a real browser layout engine. The adapter's
 * elementAtPoint() method is therefore NOT tested here; cover it with an
 * integration test that mounts a real same-origin iframe (WS-A1 follow-on).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveNearestHfElement } from "./iframe.js";
import type { ElementAtPointResult } from "./types.js";

// ─── Minimal fake element ────────────────────────────────────────────────────

interface FakeEl {
  attrs: Record<string, string>;
  tagName: string;
  parentElement: FakeEl | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function fakeEl(
  attrs: Record<string, string>,
  tagName: string,
  parent: FakeEl | null = null,
): FakeEl {
  return {
    attrs,
    tagName,
    parentElement: parent,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
  };
}

const visible = () => true;
const invisible = () => false;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveNearestHfElement", () => {
  it("returns null for a null input", () => {
    expect(resolveNearestHfElement(null, visible)).toBeNull();
  });

  it("returns the element itself when it carries data-hf-id", () => {
    const el = fakeEl({ "data-hf-id": "hf-abc" }, "div");
    const result = resolveNearestHfElement(el as unknown as Element, visible);
    expect(result).toEqual<ElementAtPointResult>({ id: "hf-abc", tag: "div" });
  });

  it("walks up to a parent that carries data-hf-id", () => {
    const parent = fakeEl({ "data-hf-id": "hf-parent" }, "section");
    const child = fakeEl({}, "span", parent);
    const result = resolveNearestHfElement(child as unknown as Element, visible);
    expect(result).toEqual<ElementAtPointResult>({ id: "hf-parent", tag: "section" });
  });

  it("returns null when the nearest data-hf-id node is data-hf-root", () => {
    const root = fakeEl({ "data-hf-id": "hf-stage", "data-hf-root": "" }, "div");
    const child = fakeEl({}, "p", root);
    expect(resolveNearestHfElement(child as unknown as Element, visible)).toBeNull();
  });

  it("returns null when the element itself is data-hf-root", () => {
    const root = fakeEl({ "data-hf-id": "hf-stage", "data-hf-root": "" }, "div");
    expect(resolveNearestHfElement(root as unknown as Element, visible)).toBeNull();
  });

  it("returns null when isVisible returns false for the matching element", () => {
    const el = fakeEl({ "data-hf-id": "hf-abc" }, "div");
    expect(resolveNearestHfElement(el as unknown as Element, invisible)).toBeNull();
  });

  it("skips an opacity-0 element and returns null (isVisible called on the resolved node)", () => {
    // isVisible is only checked on the RESOLVED node, not intermediary nodes.
    const parent = fakeEl({ "data-hf-id": "hf-parent" }, "div");
    const child = fakeEl({}, "span", parent);
    // Make parent invisible
    const isVisible = vi.fn((el: Element) => {
      const fe = el as unknown as FakeEl;
      return fe.attrs["data-hf-id"] !== "hf-parent";
    });
    expect(resolveNearestHfElement(child as unknown as Element, isVisible)).toBeNull();
    // isVisible was called once (on the resolved parent node)
    expect(isVisible).toHaveBeenCalledTimes(1);
  });

  it("returns null when no data-hf-id found in any ancestor", () => {
    const grandparent = fakeEl({}, "body");
    const parent = fakeEl({}, "div", grandparent);
    const child = fakeEl({}, "span", parent);
    expect(resolveNearestHfElement(child as unknown as Element, visible)).toBeNull();
  });

  it("tag is lowercased", () => {
    const el = fakeEl({ "data-hf-id": "hf-xyz" }, "DIV");
    const result = resolveNearestHfElement(el as unknown as Element, visible);
    expect(result?.tag).toBe("div");
  });

  it("stops at the nearest ancestor — does not continue past first data-hf-id", () => {
    const outer = fakeEl({ "data-hf-id": "hf-outer" }, "section");
    const inner = fakeEl({ "data-hf-id": "hf-inner" }, "div", outer);
    const child = fakeEl({}, "span", inner);
    const result = resolveNearestHfElement(child as unknown as Element, visible);
    expect(result?.id).toBe("hf-inner");
  });
});

// ─── select + on('selection') wiring ─────────────────────────────────────────
// These cover the adapter-level selection state without needing a real iframe.
// We import createIframePreviewAdapter and pass a stub iframe.

import { createIframePreviewAdapter } from "./iframe.js";

function stubIframe() {
  return {} as HTMLIFrameElement;
}

describe("IframePreviewAdapter selection", () => {
  it("on('selection') fires when select() is called", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-abc"]);
    expect(cb).toHaveBeenCalledWith(["hf-abc"]);
  });

  it("off unsubscribes the handler", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    const off = adapter.on("selection", cb);
    off();
    adapter.select(["hf-abc"]);
    expect(cb).not.toHaveBeenCalled();
  });

  it("additive select merges with prior selection", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-a"]);
    adapter.select(["hf-b"], { additive: true });
    expect(cb).toHaveBeenLastCalledWith(expect.arrayContaining(["hf-a", "hf-b"]));
  });

  it("non-additive select replaces prior selection", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb = vi.fn();
    adapter.on("selection", cb);
    adapter.select(["hf-a"]);
    adapter.select(["hf-b"]);
    expect(cb).toHaveBeenLastCalledWith(["hf-b"]);
  });

  it("multiple handlers all fire", () => {
    const adapter = createIframePreviewAdapter(stubIframe());
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    adapter.on("selection", cb1);
    adapter.on("selection", cb2);
    adapter.select(["hf-abc"]);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
