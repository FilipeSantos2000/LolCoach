// Overlay window position/size helpers (pure, so they can be unit tested).

const DEFAULT_SIZE = { width: 320, height: 460 };
const MIN_SIZE = { width: 260, height: 220 };
const MIN_VISIBLE = 80; // px of the window that must stay on a screen to be reachable

function defaultBounds(workArea) {
  return {
    ...DEFAULT_SIZE,
    x: workArea.x + workArea.width - DEFAULT_SIZE.width - 20,
    y: workArea.y + 80,
  };
}

function isValid(b) {
  return b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k]));
}

// True when enough of the window overlaps at least one screen to grab it.
function isReachable(b, workAreas) {
  return workAreas.some((a) => {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    return w >= Math.min(MIN_VISIBLE, b.width) && h >= Math.min(MIN_VISIBLE, b.height);
  });
}

/** Saved bounds if still usable (screens can change between sessions), else defaults. */
function restoreBounds(saved, workAreas, primaryWorkArea) {
  if (!isValid(saved)) return defaultBounds(primaryWorkArea);
  const b = {
    x: Math.round(saved.x),
    y: Math.round(saved.y),
    width: Math.max(MIN_SIZE.width, Math.round(saved.width)),
    height: Math.max(MIN_SIZE.height, Math.round(saved.height)),
  };
  return isReachable(b, workAreas) ? b : defaultBounds(primaryWorkArea);
}

/** New bounds when dragging the bottom-right corner by (dx, dy) from `start`. */
function resizeFrom(start, dx, dy) {
  return {
    x: start.x,
    y: start.y,
    width: Math.max(MIN_SIZE.width, Math.round(start.width + dx)),
    height: Math.max(MIN_SIZE.height, Math.round(start.height + dy)),
  };
}

module.exports = { DEFAULT_SIZE, MIN_SIZE, defaultBounds, restoreBounds, resizeFrom, isReachable };
