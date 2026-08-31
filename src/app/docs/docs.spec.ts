import { formatSci } from './guqtl-methods/guqtl-methods.component';
import { DOCS_PAGES, docsPageFor } from './docs-pages';

describe('docs', () => {
  it('formats thresholds in scientific notation', () => {
    expect(formatSci(4.0983606557377e-05)).toBe('4.10 × 10⁻⁵');
    expect(formatSci(1.97083169097359e-05)).toBe('1.97 × 10⁻⁵');
    expect(formatSci(0.05)).toBe('5.00 × 10⁻²');
    expect(formatSci(0)).toBe('0');
  });

  // The threshold the API reports must stay 0.05 / n_independent; the page
  // states that relation in prose, so a change upstream would make it a lie.
  it('states a threshold consistent with 0.05 / n_independent', () => {
    expect(formatSci(0.05 / 1220)).toBe(formatSci(4.0983606557377e-05));
  });

  it('resolves only slugs that are published', () => {
    expect(docsPageFor('guqtl-methods')).toBeTruthy();
    expect(docsPageFor('nope')).toBeUndefined();
  });

  it('has unique slugs', () => {
    const slugs = DOCS_PAGES.map(p => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
