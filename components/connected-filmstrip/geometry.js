/*
 * Pure geometry: fit-contain layout inside the stage + zero-gap filmstrip
 * offsets. Everything returns integer pixels — at rest the clip window edges
 * must coincide with the image edges pixel for pixel, or a sub-pixel sliver
 * of the neighbouring image bleeds through the zero-gap seam.
 */

/* Fitted rect per image: { x, y, w, h, off } — x/y centered on stage, off = offset inside the strip.
   Uniform strip height: every slide scales to fill the full stage height, so the
   seam runs the strip's full height and the filmstrip reads as one physical
   object — a wide image grows wide instead of shrinking short. Width is capped
   at the stage minus the side gutters (chrome lives there); only an image too
   wide for that falls back to width-fit and letterboxes via stripBounds. */
export function computeFits(items, W, H, gutter) {
  const maxW = W - gutter * 2;
  let off = 0;
  return items.map(({ w, h }) => {
    const s = Math.min(H / h, maxW / w);
    const fw = Math.round(w * s), fh = Math.round(h * s);
    const fit = { x: Math.round((W - fw) / 2), y: Math.round((H - fh) / 2), w: fw, h: fh, off };
    off += fw;
    return fit;
  });
}

/* Vertical union of all slides. The clip window only morphs horizontally;
   vertically it always spans this union, so a taller outgoing image is never
   cropped mid-flight by a shorter incoming one — slides stay flat peers,
   each letterboxing itself against the stage. At rest this is visually
   identical to the exact rect (beyond an image there is only stage). */
export function stripBounds(fits, H) {
  const top = Math.min(...fits.map((f) => f.y));
  const bottom = Math.min(...fits.map((f) => H - f.y - f.h));
  return { top, bottom };
}

/* Clip window → clip-path: inset() value (horizontal from the fit, vertical from the union). */
export function clipOf(fit, W, bounds) {
  return `inset(${bounds.top}px ${W - fit.x - fit.w}px ${bounds.bottom}px ${fit.x}px)`;
}

/* Strip translation: slide i's left edge lands exactly on its fitted rect (integer, no half-pixel). */
export function stripXOf(fit) {
  return fit.x - fit.off;
}
