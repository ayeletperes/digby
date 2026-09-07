/** Turning /refbook/sunburst's parallel arrays into the arrays a Plotly sunburst wants, and into colours. */

/** The locus as depth-ordered parallel arrays, exactly as the API returns it. */
export interface SunburstPayload {
  levels: string[];
  levelStart: number[];
  label: string[];
  parent: number[];
  novel: number[];
  nG: number[];
  nA: number[];
}

export interface SunburstLayout {
  /** Level of each node, 0 at the centre. */
  depth: number[];
  /** Alleles in the subtree: the arc sweep. */
  value: number[];
  /** Position among siblings, which picks the palette colour. */
  ordinal: number[];
  /** The depth-1 ancestor, which colours everything outside a drill. */
  topOf: number[];
  childCount: number[];
}

/** Level colours, carried over from the prototype dashboard. */
export const PALETTE = [
  '#66C2A5', '#FC8D62', '#8DA0CB', '#900C3F', '#E78AC3', '#A6D854',
  '#FFD92F', '#E5C494', '#8DD3C7', '#BEBADA', '#FB8072', '#80B1D3',
  '#FDB462', '#FF69B4', '#FF7F50', '#FF4500', '#FF6347', '#FF1493',
];

const LIGHTEN_PER_LEVEL = 0.05;
const WASH = 0.5;
export const DRILLED_FILL = '#9aa5a4';
export const ROOT_FILL = '#ffffff';

export function lighten(hex: string, f: number): string {
  if (f <= 0) {
    return hex;   // a no-op that still rewrites the string would change its case
  }
  const c = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (c >> 16) + 255 * f);
  const g = Math.min(255, ((c >> 8) & 0xff) + 255 * f);
  const b = Math.min(255, (c & 0xff) + 255 * f);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** A merged gene group, short enough for an arc. */
export function collapseGroup(label: string): string {
  // An allele name already contains a *, so marking a group with one would give
  const slash = label.indexOf('*') < 0 ? label.indexOf('/') : -1;
  if (slash < 0) {
    return label;
  }
  const first = label.slice(0, slash);
  return label.slice(slash + 1).startsWith(first) ? `${first}*` : label;
}

export function colour(index: number): string {
  return index >= 0 ? PALETTE[index % PALETTE.length] : ROOT_FILL;
}

export function layout(payload: SunburstPayload): SunburstLayout {
  const { label, parent, levels, levelStart } = payload;
  const n = label.length;
  const levelCount = levels.length;

  const depth = new Array<number>(n).fill(levelCount - 1);
  for (let level = 0; level < levelCount; level++) {
    const stop = level + 1 < levelCount ? levelStart[level + 1] : n;
    for (let i = levelStart[level]; i < stop; i++) {
      depth[i] = level;
    }
  }

  // forward: sibling ordinal, depth-1 ancestor, child counts
  const ordinal = new Array<number>(n).fill(0);
  const topOf = new Array<number>(n).fill(0);
  const childCount = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const p = parent[i];
    ordinal[i] = childCount[p]++;
    topOf[i] = depth[i] === 1 ? i : topOf[p];
  }

  // backward: alleles per subtree, in one pass because parent[i] < i
  const value = new Array<number>(n).fill(0);
  for (let i = n - 1; i > 0; i--) {
    if (!childCount[i]) {
      value[i] = 1;
    }
    value[parent[i]] += value[i];
  }
  if (!value[0]) {
    value[0] = 1;
  }

  return { depth, value, ordinal, topOf, childCount };
}

/** Colour is drill state, not data. */
export function fills(payload: SunburstPayload, plan: SunburstLayout,
                      drilled: number | null): string[] {
  const { parent } = payload;
  const n = payload.label.length;
  const fill = new Array<string>(n);

  if (drilled === null || drilled === 0) {
    for (let i = 0; i < n; i++) {
      fill[i] = i === 0
        ? ROOT_FILL
        : lighten(colour(plan.ordinal[plan.topOf[i]]), (plan.depth[i] - 1) * LIGHTEN_PER_LEVEL);
    }
    return fill;
  }

  // one forward pass marks the subtree and records which child of the drilled
  const branch = new Array<number>(n).fill(-1);
  const inside = new Array<boolean>(n).fill(false);
  inside[drilled] = true;
  for (let i = drilled + 1; i < n; i++) {
    const p = parent[i];
    if (p === drilled) {
      inside[i] = true;
      branch[i] = i;
    } else if (inside[p]) {
      inside[i] = true;
      branch[i] = branch[p];
    }
  }

  const drilledDepth = plan.depth[drilled];
  for (let i = 0; i < n; i++) {
    if (i === drilled) {
      fill[i] = DRILLED_FILL;
    } else if (inside[i]) {
      const base = colour(plan.ordinal[branch[i]]);
      const step = plan.depth[i] - drilledDepth - 1;
      fill[i] = step > 0 ? lighten(base, step * LIGHTEN_PER_LEVEL) : base;
    } else {
      fill[i] = i === 0 ? ROOT_FILL : lighten(colour(plan.ordinal[plan.topOf[i]]), WASH);
    }
  }
  return fill;
}
