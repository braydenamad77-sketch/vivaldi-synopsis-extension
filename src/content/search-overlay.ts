export const SEARCH_OVERLAY_VERTICAL_OFFSET_PX = 12;
export const SEARCH_OVERLAY_MARGIN_PX = 16;

type ViewportSize = {
  width: number;
  height: number;
};

type OverlaySize = {
  width: number;
  height: number;
};

type SearchOverlayKeyEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">;

const SEARCH_OVERLAY_EDITING_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getSearchOverlayPosition(viewport: ViewportSize, overlay: OverlaySize) {
  const centeredLeft = Math.round((viewport.width - overlay.width) / 2);
  const centeredTop = Math.round((viewport.height - overlay.height) / 2 + SEARCH_OVERLAY_VERTICAL_OFFSET_PX);
  const maxLeft = Math.max(SEARCH_OVERLAY_MARGIN_PX, viewport.width - overlay.width - SEARCH_OVERLAY_MARGIN_PX);
  const maxTop = Math.max(SEARCH_OVERLAY_MARGIN_PX, viewport.height - overlay.height - SEARCH_OVERLAY_MARGIN_PX);

  return {
    left: clamp(centeredLeft, SEARCH_OVERLAY_MARGIN_PX, maxLeft),
    top: clamp(centeredTop, SEARCH_OVERLAY_MARGIN_PX, maxTop),
  };
}

export function shouldCaptureSearchOverlayKey(event: SearchOverlayKeyEvent | null | undefined) {
  if (!event) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") return false;
  if (typeof event.key === "string" && event.key.length === 1) return true;
  return SEARCH_OVERLAY_EDITING_KEYS.has(String(event.key || ""));
}
