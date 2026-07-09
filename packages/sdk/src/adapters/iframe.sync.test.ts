// @vitest-environment happy-dom
/**
 * attachSync mirrors every SDK edit (including undo/redo) onto a real live
 * document — this file needs happy-dom (the package's default vitest
 * environment is "node") because it exercises iframe.contentDocument.
 */
import { describe, it, expect } from "vitest";
import { createIframePreviewAdapter } from "./iframe.js";
import { openComposition } from "../session.js";

const BASE_HTML = `
<div data-hf-id="hf-stage" data-hf-root style="width: 1280px; height: 720px" data-duration="5">
  <h1 data-hf-id="hf-title" style="color: #fff; font-size: 64px">Hello World</h1>
</div>
`.trim();

/** A same-origin iframe seeded with the given HTML, ready for contentDocument access. */
function mountIframe(html: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframe.contentDocument!.open();
  iframe.contentDocument!.write(html);
  iframe.contentDocument!.close();
  return iframe;
}

describe("IframePreviewAdapter.attachSync", () => {
  it("mirrors comp.getOverrides() onto the iframe immediately on attach", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    comp.setStyle("hf-title", { color: "#f00" }); // edit BEFORE attaching

    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("color")).toBe("#f00");
  });

  it("mirrors a style edit dispatched AFTER attaching", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);

    comp.setStyle("hf-title", { fontSize: "96px" });

    const liveTitle = iframe.contentDocument!.querySelector(
      '[data-hf-id="hf-title"]',
    ) as HTMLElement;
    expect(liveTitle.style.getPropertyValue("font-size")).toBe("96px");
  });

  it("mirrors setText, setAttribute, and removeElement", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setText("hf-title", "Goodbye");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')?.textContent).toContain("Goodbye");

    comp.setAttribute("hf-title", "data-test", "1");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')?.getAttribute("data-test")).toBe("1");

    comp.removeElement("hf-title");
    expect(liveDoc.querySelector('[data-hf-id="hf-title"]')).toBeNull();
  });

  it("mirrors undo — restores the live DOM to the pre-edit state", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setStyle("hf-title", { color: "#f00" });
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#f00");

    comp.undo();
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#fff");
  });

  it("mirrors redo after undo", async () => {
    const iframe = mountIframe(BASE_HTML);
    const comp = await openComposition(BASE_HTML);
    const adapter = createIframePreviewAdapter(iframe);
    adapter.attachSync(comp);
    const liveDoc = iframe.contentDocument!;

    comp.setStyle("hf-title", { color: "#f00" });
    comp.undo();
    comp.redo();
    expect(
      (liveDoc.querySelector('[data-hf-id="hf-title"]') as HTMLElement).style.getPropertyValue(
        "color",
      ),
    ).toBe("#f00");
  });
});
