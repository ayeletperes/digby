/**
 * Runnable check for the allele-name rules. Not part of the app build.
 *
 *   cd digby && npx tsc src/app/shared/models/gene-naming.check.ts \
 *       --outDir /tmp/gncheck --module commonjs --target es2020 --skipLibCheck \
 *   && node /tmp/gncheck/gene-naming.check.js
 */

import { nameDifferences, shortenAlleleName, shortenAlleleNames } from './gene-naming';

function ok(condition: boolean, what: string): void {
  if (!condition) { throw new Error('FAILED: ' + what); }
}

// the trap: a gene name can carry underscores of its own
ok(nameDifferences('IGHV4-NL_1*01') === 0, 'a gene with an underscore and no suffix differs at nothing');
ok(nameDifferences('IGHV4-NL_1*01_a157g') === 1, 'and one suffix counts as one');
ok(nameDifferences('IGHV1-18*01') === 0, 'a plain allele differs at nothing');
ok(nameDifferences('IGHV1-18*01_a157g_a196g') === 2, 'two substitutions count as two');
ok(nameDifferences('') === 0, 'an empty name does not throw');

// the count in a shortened label is the same count
const long = 'IGHV1-18*04' + '_a1g'.repeat(8);
const short = shortenAlleleName(long);
ok(short.startsWith('IGHV1-18*04+8~'), 'the label carries the count: ' + short);
ok(nameDifferences(long) === 8, 'and the count agrees with the label');

// labels stay unique within a group
const clashing = ['IGHV1-18*01_a157g_a196g', 'IGHV1-18*01_g276c_c291g'];
const map = shortenAlleleNames(clashing, 12);
ok(new Set(map.values()).size === 2, 'two alleles never share one label');

console.log('ok: name rules hold');
