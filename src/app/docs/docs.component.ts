import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { catchError, filter, of, switchMap, take } from 'rxjs';

import { DOCS_GROUPS, DOCS_PAGES, DocsPage } from './docs-pages';
import { WordpressService } from '../home/wordpress.service';

interface DocsGroup { name: string; pages: DocsPage[]; }

/** A WordPress help article, as the service hands it over: [title, link]. */
interface HelpArticle { title: string; link: string; }

/**
 * The documentation hub.
 *
 * Lists both halves of the documentation. Pages that quote the database are
 * in-app components from DOCS_PAGES; narrative help articles are pulled live
 * from the WordPress instance that already serves the site's help category.
 * The split is deliberate: a page stating a threshold has to be re-rendered
 * when the data is reloaded, and WordPress cannot do that.
 */
@Component({
  selector: 'app-docs',
  templateUrl: './docs.component.html',
  styleUrls: ['./docs.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterLink],
})
export class DocsComponent implements OnInit {
  readonly groups: DocsGroup[] = DOCS_GROUPS
    .map(name => ({ name, pages: DOCS_PAGES.filter(p => p.group === name) }))
    .filter(g => g.pages.length > 0);

  articles: HelpArticle[] = [];
  articlesLoading = true;
  articlesFailed = false;

  constructor(private wordpress: WordpressService) {}

  ngOnInit(): void {
    // The help URL arrives with the system config. Waiting for it rather than
    // reading it straight away keeps the request off a half-built config, which
    // would otherwise fetch the string "undefined".
    this.wordpress.sysConfig.pipe(
      filter(config => !!(config as any)?.vdjbase_help),
      take(1),
      switchMap(() => this.wordpress.fetchHelp()),
      catchError(() => { this.articlesFailed = true; return of([]); }),
    ).subscribe((posts: any[]) => {
      this.articles = (posts || []).map(p => ({ title: p[0], link: p[1] }));
      this.articlesLoading = false;
    });
  }
}
