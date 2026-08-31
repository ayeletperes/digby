import { Component, OnInit, Type } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { DocsPage, docsPageFor } from './docs-pages';

/**
 * Host for /docs/:slug.
 *
 * One route serves every documentation page: the slug is looked up in
 * DOCS_PAGES and the matching component is loaded on demand. Adding a page
 * therefore needs no routing change, and an unknown slug is a handled state
 * rather than a blank screen.
 */
@Component({
  selector: 'app-docs-page',
  templateUrl: './docs-page.component.html',
  styleUrls: ['./docs-page.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterLink],
})
export class DocsPageComponent implements OnInit {
  page: DocsPage | null = null;
  component: Type<unknown> | null = null;
  unknownSlug: string | null = null;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const slug = params.get('slug') ?? '';
      const page = docsPageFor(slug);

      if (!page) {
        this.page = null;
        this.component = null;
        this.unknownSlug = slug;
        return;
      }

      this.unknownSlug = null;
      this.page = page;
      this.component = null;
      page.load().then(component => {
        // Guard against a slower load landing after the user has moved on.
        if (this.page === page) {
          this.component = component;
        }
      });
    });
  }
}
