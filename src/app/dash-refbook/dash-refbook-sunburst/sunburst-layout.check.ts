/**
 * Runnable check for sunburst-layout. Not part of the app build: nothing imports
 * it, and tsconfig.app.json compiles only what main.ts reaches.
 *
 *   cd digby && npx tsc src/app/dash-refbook/dash-refbook-sunburst/sunburst-layout.check.ts \
 *       --outDir /tmp/sbcheck --module commonjs --target es2020 \
 *   && node /tmp/sbcheck/sunburst-layout.check.js [payload.json]
 *
 * With a payload file it runs the same checks over real API output.
 */

import {
  DRILLED_FILL, PALETTE, ROOT_FILL, SunburstPayload, collapseGroup, colour, fills, layout,
  lighten,
} from './sunburst-layout';

declare const process: { argv: string[] };
declare const require: (name: string) => any;

function ok(condition: boolean, what: string): void {
  if (!condition) {
    throw new Error('FAILED: ' + what);
  }
}

/** IGH with three gene types, so the drill cases have somewhere to go. */
const SAMPLE: SunburstPayload = {
  levels: ['chain', 'gene_type', 'subgroup', 'asc', 'allele'],
  levelStart: [0, 1, 3, 5, 8],
  label: ['IGH', 'V', 'D', 'IGHV1', 'IGHD1', 'IGHV1-2', 'IGHV1-18', 'IGHD1-7',
          'IGHV1-2*02', 'IGHV1-2*04', 'IGHV1-18*01', 'IGHD1-7*01'],
  parent: [-1, 0, 0, 1, 2, 3, 3, 4, 5, 5, 6, 7],
  novel: [1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0],
  nG: [3, 2, 1, 2, 1, 1, 1, 1, 1, 0, 1, 1],
  nA: [3, 2, 1, 2, 1, 2, 0, 1, 1, 1, 0, 1],
};

function check(payload: SunburstPayload, name: string): void {
  const n = payload.label.length;
  const plan = layout(payload);

  ok(payload.parent[0] === -1, name + ': root has no parent');
  for (let i = 1; i < n; i++) {
    ok(payload.parent[i] < i, name + ': depth ordering, parent[' + i + '] < ' + i);
  }

  ok(plan.depth[0] === 0, name + ': root at depth 0');

  // the trace is branchvalues:'total', so a parent's value must be exactly its
  // children's - Plotly drops the whole trace if a child overflows its parent
  const leaves = plan.childCount.filter((c, i) => i > 0 && !c).length;
  ok(plan.value[0] === leaves, name + ': root value is every leaf (' + plan.value[0] + ' vs ' + leaves + ')');

  const covered = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    covered[payload.parent[i]] += plan.value[i];
  }
  for (let i = 0; i < n; i++) {
    if (plan.childCount[i]) {
      ok(covered[i] === plan.value[i],
         name + ': children of ' + payload.label[i] + ' sum to it exactly');
    }
  }

  // subtree totals are what the API rolled up, recomputed the client's way
  const rolled = new Array<number>(n).fill(0);
  for (let i = n - 1; i > 0; i--) {
    if (!plan.childCount[i]) {
      rolled[i] += payload.novel[i];
    }
    rolled[payload.parent[i]] += rolled[i];
  }
  ok(rolled[0] === payload.novel[0], name + ': novel counts roll up to what the API sent');

  // colour is drill state, not data
  const base = fills(payload, plan, null);
  ok(base[0] === ROOT_FILL, name + ': undrilled root is blank');
  const tops: string[] = [];
  for (let i = 1; i < n; i++) {
    if (plan.depth[i] === 1) {
      tops.push(base[i]);
    }
  }
  ok(new Set(tops).size === tops.length, name + ': each gene type gets its own colour');
  ok(tops[0] === PALETTE[0], name + ': first gene type takes the first palette colour');

  const drilled = payload.levelStart[1];   // the first gene type
  const drill = fills(payload, plan, drilled);
  ok(drill[drilled] === DRILLED_FILL, name + ': the drilled node goes grey');

  let child = -1;
  for (let i = drilled + 1; i < n; i++) {
    if (payload.parent[i] === drilled) { child = i; break; }
  }
  ok(child > 0, name + ': the drilled node has a child to test');
  ok(drill[child] === colour(0), name + ': its first child takes a fresh palette colour');

  // a node under a different gene type must be washed out, not coloured
  let outside = -1;
  for (let i = 1; i < n; i++) {
    if (plan.depth[i] === 1 && i !== drilled) { outside = i; break; }
  }
  if (outside > 0) {
    ok(drill[outside] === lighten(colour(plan.ordinal[outside]), 0.5),
       name + ': anything outside the drilled subtree is washed out');
    ok(drill[outside] !== base[outside], name + ': and it is not left at its data colour');
  }

  console.log(name + ': ok, ' + n + ' nodes, ' + plan.value[0] + ' alleles');
}

// merged gene groups. Only the long-form kind, which repeats the stem on both
// sides, is worth collapsing; IMGT's own compact form must survive intact or a
// real gene and a merge sitting next to it both read as 12-3.
ok(collapseGroup('12-3/4') === '12-3/4', 'a compact IMGT merge is left whole');
ok(collapseGroup('12-3/4*01') === '12-3/4*01', 'and so are its alleles');
ok(collapseGroup('1-69/1-69D') === '1-69*', 'a long-form merge collapses to its first member');
ok(collapseGroup('1-69/1-69D*01') === '1-69/1-69D*01',
   'an allele of a merged group keeps its name: 1-69**01 is noise and 1-69*01 is a lie');
ok(collapseGroup('1-18') === '1-18', 'a plain gene is untouched');
ok(collapseGroup('1-18*01_a157g') === '1-18*01_a157g', 'and so is a plain allele');

check(SAMPLE, 'sample');

const file = process.argv[2];
if (file) {
  check(JSON.parse(require('fs').readFileSync(file, 'utf8')), file);
}
