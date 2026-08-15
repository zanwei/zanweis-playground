/*
 * Pure geometry: fit-contain layout inside the stage + zero-gap filmstrip
 * offsets. Everything returns integer pixels — at rest the clip window edges
 * must coincide with the image edges pixel for pixel, or a sub-pixel sliver
 * of the neighbouring image bleeds through the zero-gap seam.
 */

/* Fitted rect per image: { x, y, w, h, off } — x/y centered on stage, off = offset inside the strip. */
export function computeFits(items, W, H, margin) {
  let off = 0;
  return items.map(({ w, h }) => {
    const s = Math.min((W - margin * 2) / w, (H - margin * 2) / h);
    const fw = Math.round(w * s), fh = Math.round(h * s);
    const fit = { x: Math.round((W - fw) / 2), y: Math.round((H - fh) / 2), w: fw, h: fh, off };
    off += fw;
    return fit;
  });
}

/* Clip window rect → clip-path: inset() value. */
export function clipOf(fit, W, H) {
  return `inset(${fit.y}px ${W - fit.x - fit.w}px ${H - fit.y - fit.h}px ${fit.x}px)`;
}

/* Strip translation: slide i's left edge lands exactly on its fitted rect (integer, no half-pixel). */
export function stripXOf(fit) {
  return fit.x - fit.off;
}
