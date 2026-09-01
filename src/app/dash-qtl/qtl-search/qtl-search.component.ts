import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import { QtlService } from '../qtl.service';

export interface SearchHit {
  kind: 'variant' | 'gene';
  locus: string;
  label: string;
  detail: string;
  variant?: string;
  asc?: string;
}

/**
 * The box you type an identifier into.
 *
 * Scoped by `kind` rather than global: the two halves of the dashboard ask
 * different questions, and a search that answered both was a third control
 * competing with them. Either way it searches every locus, because someone
 * holding an id does not know which locus to look in first - the locus is part
 * of the answer.
 */
@Component({
  selector: 'app-qtl-search',
  templateUrl: './qtl-search.component.html',
  styleUrls: ['./qtl-search.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class QtlSearchComponent {
  @Input() species?: string;
  /** Which side is asking. Narrows both the query and the placeholder. */
  @Input() kind: 'variant' | 'gene' = 'variant';
  @Input() placeholder = '';

  @Output() variantPicked = new EventEmitter<{ locus: string; variant: string; asc?: string }>();
  @Output() genePicked = new EventEmitter<{ locus: string; asc: string }>();

  query = '';
  hits: SearchHit[] = [];
  searched = false;
  isSearching = false;

  private typed = new Subject<string>();

  constructor(private qtl: QtlService) {
    this.typed.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(q => {
        if (!this.species || q.trim().length < 2) {
          this.searched = false;
          return of(null);
        }
        this.isSearching = true;
        return this.qtl.search(this.species, q.trim(), this.kind)
          .pipe(catchError(() => of(null)));
      }),
    ).subscribe(result => {
      this.isSearching = false;
      if (!result) {
        this.hits = [];
        return;
      }
      this.searched = true;
      this.hits = [
        ...(result.genes ?? []).map((g: any): SearchHit => ({
          kind: 'gene', locus: g.locus, label: g.gene ?? g.asc, asc: g.asc,
          detail: g.n_significant
            ? `${g.n_significant} of ${g.n_variants} variants significant`
            : 'no significant variants',
        })),
        ...(result.variants ?? []).map((v: any): SearchHit => ({
          kind: 'variant', locus: v.locus, label: v.variant, variant: v.variant, asc: v.asc,
          detail: v.significant
            ? `QTL for ${v.asc}, -log10 p ${v.neglog10_p.toFixed(1)}`
            : `tested, not significant (best -log10 p ${v.neglog10_p.toFixed(1)})`,
        })),
      ];
    });
  }

  onType(): void {
    this.typed.next(this.query);
  }

  choose(hit: SearchHit): void {
    if (hit.kind === 'variant' && hit.variant) {
      this.variantPicked.emit({ locus: hit.locus, variant: hit.variant, asc: hit.asc });
    } else if (hit.asc) {
      this.genePicked.emit({ locus: hit.locus, asc: hit.asc });
    }
    this.query = '';
    this.hits = [];
    this.searched = false;
  }
}
