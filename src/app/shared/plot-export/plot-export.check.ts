/**
 * Runnable check for plot-export. Not part of the app build: nothing imports it.
 *
 *   cd digby && npx tsc src/app/dash-refbook/plot-export/plot-export.check.ts \
 *       --outDir /tmp/pxcheck --module commonjs --target es2020 --skipLibCheck \
 *   && node /tmp/pxcheck/plot-export.check.js
 */

import { ExportTrace, python, table, tsv } from './plot-export';

function ok(condition: boolean, what: string): void {
  if (!condition) { throw new Error('FAILED: ' + what); }
}

// the overview: horizontal grouped bars, one series per database, plus the
// invisible trace that exists only to anchor the mirrored axis
const BARS: ExportTrace[] = [
  { type: 'bar', orientation: 'h', name: 'Genomic',
    y: ['IGHV3-33*01', 'IGHV3-33*06'], x: [264, 38] },
  { type: 'bar', orientation: 'h', name: 'AIRR-seq',
    y: ['IGHV3-33*01', 'IGHV3-33*06'], x: [352, 88] },
  { type: 'scatter', orientation: 'h', showlegend: false, x: [null], y: [null] },
];
const BAR_LAYOUT = {
  xaxis: { title: { text: 'Samples carrying the allele' } },
  yaxis: { title: { text: 'Allele' } },
};

const bars = table(BARS, BAR_LAYOUT);
ok(bars.columns.join('|') === 'Allele|series|Samples carrying the allele',
   'columns come from the axis titles, category first');
ok(bars.rows.length === 4, 'the anchor trace contributes no rows, got ' + bars.rows.length);
ok(bars.rows[0][0] === 'IGHV3-33*01' && bars.rows[0][2] === 264, 'first row is the first bar');
ok(!bars.rows.some(r => r[2] === null || r[2] === undefined), 'no empty values survive');

const text = tsv(bars);
ok(text.split('\n')[0].split('\t').length === 3, 'header has one field per column');
ok(text.trim().split('\n').length === 5, 'one header and four rows');

// a box trace: many values against one repeated category
const BOXES: ExportTrace[] = [
  { type: 'box', orientation: 'h', name: 'IGHV3-33*01',
    x: [0.01, 0.02, 0.03], y: ['IGHV3-33*01', 'IGHV3-33*01', 'IGHV3-33*01'] },
];
const boxes = table(BOXES, {
  xaxis: { title: { text: 'Relative usage (fraction of rearrangements)' } },
  yaxis: { title: { text: 'Allele' } },
});
ok(boxes.rows.length === 3, 'one row per sample, got ' + boxes.rows.length);

// a category repeated once against many values still expands
const SHARED: ExportTrace[] = [
  { type: 'box', orientation: 'h', name: 'x', x: [1, 2, 3], y: ['g'] },
];
ok(table(SHARED, {}).rows.length === 3, 'a single category is reused down the values');

// vertical charts read the other way round
const VERTICAL: ExportTrace[] = [
  { type: 'bar', name: 'Genomic', x: ['P1', 'P2'], y: [3, 4] },
];
const vert = table(VERTICAL, {
  xaxis: { title: { text: 'Project' } }, yaxis: { title: { text: 'Samples carrying the allele' } },
});
ok(vert.columns[0] === 'Project', 'category is x when the bars are vertical');
ok(vert.rows[0][2] === 3, 'value is y when the bars are vertical');

// unnamed traces drop the series column rather than emitting a blank one
const UNNAMED: ExportTrace[] = [{ type: 'bar', orientation: 'h', y: ['a'], x: [1] }];
ok(table(UNNAMED, {}).columns.length === 2, 'no series column without a series');

// the script has to be syntactically plausible and carry the data
const script = python(bars, {
  title: 'Alleles of IGHV3-33', source: '/api/refbook/ascs_overview/Human/IGH/IGHV3-33',
  kind: 'bar', horizontal: true,
});
ok(script.includes('import pandas as pd'), 'script imports pandas');
ok(script.includes('barh'), 'a horizontal chart plots as barh');
ok(script.includes("'IGHV3-33*01'"), 'the rows are in the script');
ok(script.includes('/api/refbook/ascs_overview/'), 'the endpoint is named');
ok((script.match(/\[/g) || []).length === (script.match(/\]/g) || []).length,
   'brackets balance');

// an allele name with an apostrophe must not break the literal
const QUOTED = table([{ type: 'bar', orientation: 'h', y: ["it's"], x: [1] }], {});
ok(python(QUOTED, { title: 't', source: 's', kind: 'bar', horizontal: true })
     .includes("'it\\'s'"), 'quotes in a label are escaped');

const boxScript = python(boxes, {
  title: 'Usage', source: 's', kind: 'box', horizontal: true,
});
ok(boxScript.includes('ax.boxplot'), 'a box chart plots as a boxplot');
ok(boxScript.includes('vert=False'), 'and keeps the orientation');

console.log('ok: ' + bars.rows.length + ' bar rows, ' + boxes.rows.length + ' box rows, '
            + script.split('\n').length + '-line script');
