import { Type } from '@angular/core';

/**
 * One in-app documentation page.
 *
 * Adding a page is a component plus an entry in DOCS_PAGES below. The hub grid,
 * the grouping, and the slug validation done by DocsPageComponent are all
 * derived from this list, so nothing else needs editing.
 *
 * Narrative documentation (how-tos, tutorials, news) is NOT listed here. It
 * lives in WordPress and is fetched by the hub through WordpressService. Only
 * pages that quote numbers out of the loaded database belong in this registry,
 * because those have to be rendered from the API to stay correct across a
 * reload.
 */
export interface DocsPage {
  /**
   * Stable identifier. This is the URL (/docs/<slug>) and it is what external
   * links and citations point at, so do not rename one once it has shipped.
   * Retitling a page is free; re-slugging it breaks other people's links.
   */
  slug: string;
  title: string;
  /** Heading this page is listed under on the hub. */
  group: string;
  /** One line describing the page, shown on its hub card. */
  summary: string;
  load: () => Promise<Type<unknown>>;
}

/** Page groups, in the order the hub lists them. */
export const DOCS_GROUPS = ['Methods'];

export const DOCS_PAGES: DocsPage[] = [
  {
    slug: 'guqtl-methods',
    group: 'Methods',
    title: 'Gene usage QTL: methods',
    summary: 'How the guQTL scan is run and how to read its output: the usage ' +
             'phenotype, the per-ASC significance threshold, and what the scan ' +
             'deliberately does not claim.',
    load: () => import('./guqtl-methods/guqtl-methods.component')
      .then(m => m.GuqtlMethodsComponent),
  },
];

/** The page for a slug, or undefined when the slug is not one we publish. */
export function docsPageFor(slug: string): DocsPage | undefined {
  return DOCS_PAGES.find(p => p.slug === slug);
}
