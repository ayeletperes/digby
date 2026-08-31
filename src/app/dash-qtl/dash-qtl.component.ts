import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import { QtlService } from './qtl.service';
import { QtlManhattanComponent } from './qtl-manhattan/qtl-manhattan.component';
import { QtlVariantComponent } from './qtl-variant/qtl-variant.component';
import { QtlSearchComponent } from './qtl-search/qtl-search.component';
import { QtlVariantLookupComponent } from './qtl-variant-lookup/qtl-variant-lookup.component';
import { QtlRegionComponent } from './qtl-region/qtl-region.component';
import { QtlAsc, QtlSelection } from '../shared/models/qtl-selection.model';
import { ascDisplayName } from '../shared/models/gene-naming';

/**
 * The guQTL dashboard.
 *
 * Its own route rather than a section of the reference dashboard: that one
 * selects on species/locus/segment/gene/allele across two databases, this one on
 * species/locus/ASC/variant within one association run, over a different cohort.
 * Sharing a shell would leave half the filters inert on either side.
 */
@Component({
  selector: 'app-dash-qtl',
  templateUrl: './dash-qtl.component.html',
  styleUrls: ['./dash-qtl.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, QtlManhattanComponent, QtlVariantComponent,
            QtlSearchComponent, QtlVariantLookupComponent, QtlRegionComponent],
})
export class DashQtlComponent implements OnInit, OnDestroy {
  /** An ASC written as a gene name; IGH's D clusters already carry the locus. */
  readonly ascName = ascDisplayName;

  selection: QtlSelection = {};

  /**
   * Which question is being asked.
   *
   * `gene` starts from a gene and asks which variants explain its usage;
   * `variant` starts from a variant and asks which genes it explains. They are
   * the same data read from opposite ends, and people arrive holding one or the
   * other, so neither is made to go through the other first.
   *
   * Each tab owns one control of the shape its own question needs - the ~35
   * genes are worth browsing in a list, the thousands of variants have to be
   * searched - and that control lives in the tab rather than in the rail, so
   * there is exactly one place to make a choice at any moment.
   */
  view: 'gene' | 'variant' = 'gene';

  /**
   * The other half of the pair being plotted, or absent when nothing is.
   *
   * Kept apart from the two subjects because `selection.asc` belongs to the gene
   * tab and `selection.variant` to the variant tab: if the drill-down reused
   * them, switching tabs would have to throw one away, and coming back would
   * find it gone. `plot` is the only thing a tab switch clears.
   */
  plot?: string;

  species: string[] = [];
  loci: Record<string, string[]> = {};
  ascs: QtlAsc[] = [];

  loading = false;
  error: string | null = null;

  /** Collapses so a wide plot can use the whole width. */
  railOpen = true;

  private destroy$ = new Subject<void>();

  constructor(private qtl: QtlService,
              private route: ActivatedRoute,
              private router: Router) {}

  ngOnInit(): void {
    this.restoreFromUrl();
    this.sync();

    this.qtl.speciesAndLoci()
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? 'No guQTL results are available';
        return EMPTY;
      }), takeUntil(this.destroy$))
      .subscribe(result => {
        this.species = result.species ?? [];
        this.loci = result.loci ?? {};

        if (!this.selection.species || !this.species.includes(this.selection.species)) {
          this.selection = { ...this.selection, species: this.species[0] };
        }
        const available = this.lociFor(this.selection.species);
        if (!this.selection.locus || !available.includes(this.selection.locus)) {
          this.selection = { ...this.selection, locus: available[0] };
        }
        this.loadAscs();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  lociFor(species?: string): string[] {
    return species ? (this.loci[species] ?? []) : [];
  }

  /** ASCs worth offering first: the ones that actually have a signal. */
  get rankedAscs(): QtlAsc[] {
    return [...this.ascs].sort((a, b) => b.n_significant - a.n_significant
                                      || b.best_neglog10_p - a.best_neglog10_p);
  }

  onSpeciesChange(): void {
    this.selection = { ...this.selection, locus: this.lociFor(this.selection.species)[0],
                       asc: undefined, variant: undefined };
    this.loadAscs();
  }

  onLocusChange(): void {
    // an ASC belongs to a locus, and so does a variant
    this.selection = { ...this.selection, asc: undefined, variant: undefined };
    this.loadAscs();
  }

  /**
   * A different gene is a different scan, so the plotted variant goes with it.
   *
   * The object is replaced, not just read. `[(ngModel)]="selection.asc"` writes
   * into the existing one, which leaves its identity unchanged - the panels take
   * `selection` as an `@Input`, so without a new object their `ngOnChanges`
   * never fires and the plot keeps showing the previous gene's scan.
   */
  onAscChange(): void {
    this.selection = { ...this.selection };
    this.plot = undefined;
    this.pointAsc = undefined;
    this.writeToUrl();
  }

  /** The ASC a clicked point came from, when the scan was the whole-locus one. */
  pointAsc?: string;

  /**
   * A clicked scan point names its own gene, so it goes straight to the plot.
   *
   * Unlike a searched id, which knows only its strongest hit and so lands on the
   * variant's whole table, a point *is* one variant against one gene - the pair
   * the boxplot draws.
   */
  onVariantPicked(event: { variant: string; asc?: string }): void {
    this.plot = event.variant;
    // in the whole-locus overview the point carries the gene whose scan made it
    this.pointAsc = event.asc;
    if (!this.selection.asc && event.asc) {
      this.selection = { ...this.selection, asc: event.asc };
    }
    this.writeToUrl();
  }

  /**
   * A neighbour in the region track becomes the variant on screen.
   *
   * Which field it lands in depends on the tab. The gene tab holds a gene and
   * plots a variant against it, so the new variant is `plot`; the variant tab
   * holds the variant itself, so it is `selection.variant` and whatever gene was
   * being plotted stays. Either way the pair keeps the half that was not clicked.
   */
  onRegionVariant(variant: string): void {
    if (this.view === 'gene') {
      this.plot = variant;
    } else {
      this.selection = { ...this.selection, variant };
    }
    this.writeToUrl();
  }

  /** Pick the gene whose scan to look at, from the variant's own table. */
  onAscPicked(asc: string): void {
    if (this.view === 'gene') {
      this.selection = { ...this.selection, asc };
    } else {
      this.plot = asc;
    }
    this.writeToUrl();
  }

  /**
   * A search hit knows its own locus, which may not be the one on screen.
   *
   * A variant lands on its own table rather than straight on a plot: the search
   * only knows its single strongest hit, and the question behind typing an id is
   * which genes it drives, which is the whole table.
   */
  onSearchVariant(hit: { locus: string; variant: string; asc?: string }): void {
    const moved = hit.locus !== this.selection.locus;
    // no gene: the search knows only this variant's strongest hit, and the
    // question behind typing an id is which genes it drives - the whole table
    this.selection = { ...this.selection, locus: hit.locus, variant: hit.variant };
    this.plot = undefined;
    this.pointAsc = undefined;
    if (moved) {
      this.loadAscs();
    } else {
      this.writeToUrl();
    }
  }

  onSearchGene(hit: { locus: string; asc: string }): void {
    const moved = hit.locus !== this.selection.locus;
    this.view = 'gene';
    this.selection = { ...this.selection, locus: hit.locus, asc: hit.asc, variant: undefined };
    if (moved) {
      this.loadAscs();
    } else {
      this.writeToUrl();
    }
  }

  /** What the open analysis is showing, said under the list. */
  get viewNote(): string {
    const { locus, asc, variant } = this.selection;
    if (this.plot) {
      return 'Usage by genotype for the pair below.';
    }
    if (this.view === 'gene') {
      return asc
        ? `One scan: every variant tested against ${ascDisplayName(locus, asc)}.`
        : `No single scan — each variant's best result across every gene in `
          + `${locus ?? 'the locus'}.`;
    }
    return variant
      ? `Every gene ${variant} was tested against.`
      : 'Enter a variant id to see which genes it explains.';
  }

  /** True when a variant-gene pair is being plotted. */
  get isPlotting(): boolean {
    return !!this.plot;
  }

  /**
   * The pair the boxplot draws: this tab's subject plus `plot`.
   *
   * A stored field, not a getter. A getter would build a new object on every
   * change-detection pass, which Angular reads as a changed `@Input` - the child
   * would refetch on every pass and never finish. Recomputed only in `sync()`.
   */
  plotSelection: QtlSelection = {};

  /**
   * Rebuild everything derived from (selection, view, plot).
   *
   * Only replaces the object when a field the child reads has actually moved.
   * `loadAscs` finishing writes the URL again, which would otherwise hand the
   * child an equal-but-new object and buy a second identical round trip.
   */
  private sync(): void {
    const next = this.view === 'gene'
      ? { ...this.selection, variant: this.plot }
      : { ...this.selection, asc: this.plot };
    const now = this.plotSelection;
    if (now.species !== next.species || now.locus !== next.locus
        || now.asc !== next.asc || now.variant !== next.variant) {
      this.plotSelection = next;
    }
  }

  /** How many of the locus's genes have any significant variant at all. */
  get ascsWithSignal(): number {
    return this.ascs.filter(a => a.n_significant > 0).length;
  }

  /**
   * The other half of the pair, once one has been drilled into.
   *
   * Each tab holds its own subject - a gene here, a variant there - so what is
   * worth naming is whatever was drilled into from it.
   */
  get chosen(): string | null {
    if (!this.plot) {
      return null;
    }
    return this.view === 'gene' ? this.plot
                               : ascDisplayName(this.selection.locus, this.plot);
  }

  /** Back out of the plotted pair, to whatever this tab was showing before. */
  clearDrill(): void {
    this.plot = undefined;
    this.pointAsc = undefined;
    this.writeToUrl();
  }

  /**
   * Switching tabs drops the plot, and nothing else.
   *
   * Each tab keeps the subject it was working on, so coming back finds the gene
   * or the variant still there. Only the pair being plotted is specific to the
   * tab it was opened from.
   */
  showView(view: 'gene' | 'variant'): void {
    this.view = view;
    this.plot = undefined;
    this.pointAsc = undefined;
    this.writeToUrl();
  }

  /**
   * A variant resolved from a bare id, which is how its locus is learnt.
   *
   * The lookup finds the locus rather than being told it, so the rest of the
   * shell follows it there - otherwise the header keeps naming the locus that
   * happened to be selected while the table below shows a different one.
   */
  onLookupResolved(hit: { locus: string; variant: string }): void {
    if (hit.locus !== this.selection.locus) {
      this.selection = { ...this.selection, locus: hit.locus, asc: undefined };
      this.loadAscs();
    } else {
      this.writeToUrl();
    }
  }

  /** A row of the variant's table: this variant, against this one gene. */
  onLookupDrill(hit: { locus: string; variant: string; asc: string }): void {
    const moved = hit.locus !== this.selection.locus;
    this.selection = { ...this.selection, locus: hit.locus, variant: hit.variant };
    this.plot = hit.asc;
    this.pointAsc = hit.asc;
    if (moved) {
      this.loadAscs();
    } else {
      this.writeToUrl();
    }
  }

  private loadAscs(): void {
    const { species, locus } = this.selection;
    if (!species || !locus) {
      this.ascs = [];
      return;
    }

    this.loading = true;
    this.qtl.ascs(species, locus)
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? 'Could not load the ASCs';
        this.loading = false;
        return EMPTY;
      }), takeUntil(this.destroy$))
      .subscribe(result => {
        this.loading = false;
        this.ascs = result.ascs ?? [];
        if (this.selection.asc && !this.ascs.some(a => a.asc === this.selection.asc)) {
          this.selection = { ...this.selection, asc: undefined };
        }
        if (this.plot && this.view === 'variant'
            && !this.ascs.some(a => a.asc === this.plot)) {
          this.plot = undefined;
        }
        this.writeToUrl();
      });
  }

  // ------------------------------------------------------------------- URL

  private writeToUrl(): void {
    this.sync();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        species: this.selection.species ?? null,
        locus: this.selection.locus ?? null,
        asc: this.selection.asc ?? null,
        variant: this.selection.variant ?? null,
        view: this.view === 'gene' ? null : this.view,
        plot: this.plot ?? null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  private restoreFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    this.view = params.get('view') === 'variant' ? 'variant' : 'gene';
    this.plot = params.get('plot') ?? undefined;
    this.selection = {
      species: params.get('species') ?? undefined,
      locus: params.get('locus') ?? undefined,
      asc: params.get('asc') ?? undefined,
      variant: params.get('variant') ?? undefined,
    };
  }
}
