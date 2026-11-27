/**
 * Version parsing and comparison.
 *
 * Split out of `tools.mjs` (Gate 4: 18 exports, maximum 10). These two do no
 * I/O and depend on nothing, which makes them the part of tool classification
 * that can be reasoned about with a pencil -- and the part tests can pin without
 * a fake process anywhere.
 */

export function semverOf(value) {
  const m = String(value || '').match(/(\d+(?:\.\d+){1,3})/);
  return m ? m[1] : '';
}

/** Component-wise compare; missing components are zero. */
export function cmpVersion(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const width = Math.max(pa.length, pb.length);
  for (let i = 0; i < width; i += 1) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

function parts(value) {
  return semverOf(value).split('.').map(Number);
}
