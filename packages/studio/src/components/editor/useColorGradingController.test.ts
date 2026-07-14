// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import { useColorGradingController } from "./useColorGradingController";
import type { DomEditSelection } from "./domEditing";

function freshPopGrading() {
  const next = normalizeHfColorGrading({ preset: "fresh-pop", intensity: 1 });
  if (!next) throw new Error("expected fresh-pop preset to normalize");
  return next;
}

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function makeElement(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    element: document.createElement("video"),
    id: "s1-bg",
    selector: "#s1-bg",
    label: "S1 Background",
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
    textContent: "",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    ...overrides,
  } as DomEditSelection;
}

function HookHost({
  onState,
  onSetAttributeLive,
  element,
}: {
  onState: (state: ReturnType<typeof useColorGradingController>) => void;
  onSetAttributeLive: (attr: string, value: string | null) => void;
  element: DomEditSelection;
}) {
  const state = useColorGradingController({
    projectId: "proj",
    element,
    onSetAttributeLive,
  });
  onState(state);
  return null;
}

function renderHook(
  onSetAttributeLive: (attr: string, value: string | null) => void,
  initialElement: DomEditSelection = makeElement(),
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let latest: ReturnType<typeof useColorGradingController> | undefined;
  const renderWith = (element: DomEditSelection) => {
    act(() => {
      root.render(
        React.createElement(HookHost, {
          onState: (s: ReturnType<typeof useColorGradingController>) => (latest = s),
          onSetAttributeLive,
          element,
        }),
      );
    });
  };
  renderWith(initialElement);
  return {
    root,
    rerenderWithElement: renderWith,
    // A method, not a getter — `const { state } = renderHook(...)` would
    // destructure a getter into a one-time snapshot, silently going stale
    // after the first state change. Call `.getState()` fresh every time.
    getState(): ReturnType<typeof useColorGradingController> {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
  };
}

describe("useColorGradingController", () => {
  it("starts with the neutral (inactive) grading and idle compare state", () => {
    const { root, getState } = renderHook(vi.fn());
    expect(getState().grading.preset).toBe("neutral");
    expect(getState().compareEnabled).toBe(false);
    act(() => root.unmount());
  });

  it("commitColorGrading updates grading state synchronously and schedules a debounced persist", async () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const { root, getState } = renderHook(onSetAttributeLive);
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    expect(onSetAttributeLive).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).toHaveBeenCalledTimes(1);
    const [attr, value] = onSetAttributeLive.mock.calls[0] as [string, string];
    expect(attr).toBe("color-grading");
    expect(value).toContain("fresh-pop");
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("resetGrading returns to the neutral preset", () => {
    const { root, getState } = renderHook(vi.fn());
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    act(() => {
      getState().resetGrading();
    });
    expect(getState().grading.preset).toBe("neutral");
    act(() => root.unmount());
  });

  it("resets grading/compare state when selection changes to a different element", () => {
    const { root, getState, rerenderWithElement } = renderHook(
      vi.fn(),
      makeElement({ id: "s1-bg" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    expect(getState().grading.preset).toBe("fresh-pop");
    // A different element, with no persisted grading of its own — without a
    // reset, this hook (unlike the legacy component it was extracted from,
    // which remounts via a `key={selectionIdentityKey}`) would keep showing
    // the previous element's grading.
    rerenderWithElement(makeElement({ id: "s2-bg" }));
    expect(getState().grading.preset).toBe("neutral");
    act(() => root.unmount());
  });

  it("cancels a pending persist scheduled for the previous element when selection changes before it flushes", () => {
    vi.useFakeTimers();
    const onSetAttributeLive = vi.fn();
    const { root, getState, rerenderWithElement } = renderHook(
      onSetAttributeLive,
      makeElement({ id: "s1-bg" }),
    );
    act(() => {
      getState().commitColorGrading(freshPopGrading());
    });
    // Switch selection before the 350ms debounce flushes — the queued write
    // targeted the OLD element and must not land on whatever is selected now.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerenderWithElement(makeElement({ id: "s2-bg" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(onSetAttributeLive).not.toHaveBeenCalled();
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("does not permanently cache a non-OK media/metadata response — the next mount retries", async () => {
    const videoWithSrc = () => {
      const el = document.createElement("video");
      el.setAttribute("src", "clip.mp4");
      return el;
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ metadata: { kind: "video", color: { dynamicRange: "hdr" } } }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const first = renderHook(vi.fn(), makeElement({ id: "retry-asset", element: videoWithSrc() }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.getState().mediaMetadata).toBeNull();
    act(() => first.root.unmount());

    // A second, independent mount for the SAME asset path — if the failed
    // response had been cached, this would never re-fetch and mediaMetadata
    // would stay null forever.
    const second = renderHook(
      vi.fn(),
      makeElement({ id: "retry-asset-2", element: videoWithSrc() }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.getState().mediaMetadata?.color.dynamicRange).toBe("hdr");
    act(() => second.root.unmount());
    vi.unstubAllGlobals();
  });
});
