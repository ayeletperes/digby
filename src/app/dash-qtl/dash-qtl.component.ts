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
import { QtlPairingComponent } from './qtl-pairing/qtl-pairing.component';
import { QtlSummaryComponent } from './qtl-summary/qtl-summary.component';
import { GalleryPanel, PanelGalleryComponent, thumb }
  from '../shared/panel-gallery/panel-gallery.component';
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
            QtlSearchComponent, QtlVariantLookupComponent, QtlRegionComponent,
            QtlPairingComponent, QtlSummaryComponent, PanelGalleryComponent],
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
  view: 'gene' | 'variant' | 'pairing' | 'summary' = 'summary';

  /**
   * True while the cards are up, which is whenever the URL names no analysis.
   *
   * A deep link, a drill from another panel and the browser's back button all
   * name one, so the gallery never stands between a reader and the analysis they
   * asked for. `view` keeps its own default so that leaving the cards lands
   * somewhere sensible rather than nowhere.
   */
  atGallery = true;

  /** The analyses as cards. The same four the rail lists, in the same order. */
  readonly galleryPanels: GalleryPanel[] = [
    { id: 'summary', group: 'Overview', label: 'Summary of hits',
      description: 'Every significant variant in the run at once, by which '
                 + "segment's genes it explains and what it sits in." },
    { id: 'gene', group: 'One at a time', label: 'Start from a gene',
      description: 'Pick a gene and see every variant tested against its usage, '
                 + 'along the locus.' },
    { id: 'variant', group: 'One at a time', label: 'Start from a variant',
      description: 'Pick a variant and see every gene whose usage it was tested '
                 + 'against, and what it sits in.' },
    { id: 'pairing', group: 'One at a time', label: 'Gene pairing',
      description: 'Whether a variant moves which partner a gene recombines '
                 + 'with, in either direction. IGH only.' },
  ];

  readonly galleryGroups = ['Overview', 'One at a time'];

  /**
   * Drawings for the four cards.
   *
   * Built with the shared `thumb` rather than added to the reference
   * dashboard's map, so the two dashboards do not share a file to collide in.
   */
  readonly galleryArt: Record<string, string> = {
    summary: thumb('<rect x="14" y="34" width="14" height="30" fill="var(--vdj-teal,#188080)"/>'
      + '<rect x="32" y="20" width="14" height="44" fill="#8b6bb1"/>'
      + '<rect x="54" y="44" width="14" height="20" fill="#e8a33d"/>'
      + '<rect x="72" y="14" width="14" height="50" fill="#8b6bb1"/>'
      + '<rect x="90" y="50" width="14" height="14" fill="#35a67c"/>'),
    gene: thumb('<line x1="10" y1="52" x2="110" y2="52" stroke="rgba(24,128,128,0.28)"/>'
      + '<circle cx="24" cy="44" r="3" fill="rgba(24,128,128,0.28)"/>'
      + '<circle cx="40" cy="46" r="3" fill="rgba(24,128,128,0.28)"/>'
      + '<circle cx="56" cy="20" r="4" fill="#d62839"/>'
      + '<circle cx="62" cy="28" r="4" fill="#d62839"/>'
      + '<circle cx="78" cy="42" r="3" fill="rgba(24,128,128,0.28)"/>'
      + '<circle cx="96" cy="47" r="3" fill="rgba(24,128,128,0.28)"/>'),
    variant: thumb('<line x1="60" y1="10" x2="60" y2="62" stroke="var(--vdj-teal,#188080)"'
      + ' stroke-dasharray="3 3"/><circle cx="60" cy="16" r="5" fill="#fff"'
      + ' stroke="#202124" stroke-width="2"/>'
      + '<rect x="18" y="42" width="26" height="9" fill="#188080"/>'
      + '<rect x="76" y="42" width="26" height="9" fill="#188080"/>'
      + '<rect x="46" y="42" width="8" height="9" fill="#e08a1e"/>'),
    pairing: thumb('<rect x="16" y="18" width="30" height="9" fill="#2a78d6"/>'
      + '<rect x="16" y="32" width="30" height="9" fill="#e34948"/>'
      + '<rect x="16" y="46" width="30" height="9" fill="#eda100"/>'
      + '<rect x="74" y="18" width="30" height="9" fill="#2a78d6"/>'
      + '<rect x="74" y="32" width="30" height="9" fill="#e34948"/>'
      + '<rect x="74" y="46" width="30" height="9" fill="#eda100"/>'
      + '<line x1="46" y1="22" x2="74" y2="50" stroke="rgba(24,128,128,0.5)"/>'
      + '<line x1="46" y1="50" x2="74" y2="22" stroke="rgba(24,128,128,0.5)"/>'),
  };

  /** Why a card cannot be opened. Only pairing has a reason, and only off IGH. */
  readonly galleryBlocked = (panel: GalleryPanel): string | null =>
    panel.id === 'pairing' && this.selection.locus !== 'IGH'
      ? `No partner-pairing scan has been run for ${this.selection.locus ?? 'this locus'}.`
        + ' Only IGH has one loaded.'
      : null;

  openFromGallery(panel: GalleryPanel): void {
    this.showView(panel.id as 'gene' | 'variant' | 'pairing' | 'summary');
  }

  /** Back to the cards, which is the one state the URL says nothing about. */
  showGallery(): void {
    this.atGallery = true;
    this.writeToUrl();
  }

  /**
   * Whether an analysis is the open one, for the rail's highlight.
   *
   * `view` keeps its value while the cards are up, so that leaving them lands
   * somewhere sensible. That means it cannot answer this on its own: with the
   * gallery open it still said 'summary', and Home and Summary of hits lit up
   * together. Nothing is the open analysis while the cards are up.
   */
  isOpen(view: string): boolean {
    return !this.atGallery && this.view === view;
  }

  /** The open analysis, for the title beside the way back. */
  get openPanelLabel(): string {
    return this.galleryPanels.find(p => p.id === this.view)?.label ?? '';
  }

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
        // a direct link to the pairing tab restores the view without going
        // through showView, so the list it needs has to be asked for here too
        if (this.view === 'pairing') {
          this.loadPairingVariants();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  lociFor(species?: string): string[] {
    return species ? (this.loci[species] ?? []) : [];
  }

  // ------------------------------------------------- the pairing tab's subject
  /**
   * Which variant the pairing analysis is about, and in which direction.
   *
   * Held here rather than inside the panel because every other analysis has its
   * subject chosen in the rail, and this one was the exception: its picker sat
   * in a card beside the figure. The panel draws what it is handed.
   *
   * The ranking depends on the direction, since P(J|D) and P(D|J) are separate
   * scans, so the direction control sits with the list it reorders.
   */
  readonly conditionals = ['P(J|D)', 'P(D|J)'];
  pairingConditional = 'P(J|D)';
  pairingVariant: string | null = null;
  pairingVariants: any[] = [];
  pairingScanned = 0;
  pairingHasScan = true;
  pairingLoading = false;
  pairingError: string | null = null;
  pairingFilter = '';

  get shownPairingVariants(): any[] {
    const q = this.pairingFilter.trim().toUpperCase();
    const all = this.pairingVariants;
    return (q ? all.filter(v => v.variant.toUpperCase().includes(q)
                             || (v.gene ?? '').toUpperCase().includes(q))
              : all).slice(0, 60);
  }

  get pairingAnchorSide(): string {
    return this.pairingConditional === 'P(J|D)' ? 'J' : 'D';
  }

  setConditional(conditional: string): void {
    if (conditional === this.pairingConditional) {
      return;
    }
    this.pairingConditional = conditional;
    // a different conditional is a different scan over the same variants, so
    // its ranking is different and the chosen variant may not be in it
    this.pairingVariant = null;
    this.loadPairingVariants();
  }

  pickPairingVariant(variant: string): void {
    this.pairingVariant = variant;
  }

  private loadPairingVariants(): void {
    const { species, locus } = this.selection;
    if (!species || !locus) {
      this.pairingVariants = [];
      return;
    }
    this.pairingLoading = true;
    this.pairingError = null;

    this.qtl.pairingVariants(species, locus, this.pairingConditional, 400)
      .pipe(catchError(err => {
        this.pairingError = err?.error?.message
          ?? `No partner-pairing scan is held for ${locus}`;
        this.pairingLoading = false;
        this.pairingVariants = [];
        return EMPTY;
      }), takeUntil(this.destroy$))
      .subscribe(result => {
        this.pairingLoading = false;
        this.pairingVariants = result.variants ?? [];
        this.pairingScanned = result.n_variants_scanned ?? 0;
        this.pairingHasScan = !!result.scanned;
        if (this.pairingVariant
            && !this.pairingVariants.some((v: any) => v.variant === this.pairingVariant)) {
          this.pairingVariant = null;
        }
      });
  }

  /** ASCs worth offering first: the ones that actually have a signal. */
  get rankedAscs(): QtlAsc[] {
    return [...this.ascs].sort((a, b) => b.n_significant - a.n_significant
                                      || b.best_neglog10_p - a.best_neglog10_p);
  }

  /** Narrow the gene list by segment, by typed name, or both. */
  ascSegment = '';
  ascFilter = '';

  /** Segments this locus actually scanned - IGH has three, the light chains two. */
  get segmentsPresent(): string[] {
    const order = ['V', 'D', 'J', 'C'];
    const present = new Set(this.ascs.map(a => a.segment));
    return order.filter(s => present.has(s))
      .concat([...present].filter(s => !order.includes(s)).sort());
  }

  /**
   * The gene list after the filters.
   *
   * Matched against the name as typed *and* as displayed: IGH's D clusters are
   * stored `IGHD5-12` and the light chains' bare `V9-49`, so someone typing
   * "IGHV3" or "V3" should find the same gene either way.
   */
  get filteredAscs(): QtlAsc[] {
    const q = this.ascFilter.trim().toUpperCase();
    return this.rankedAscs.filter(a =>
      (!this.ascSegment || a.segment === this.ascSegment)
      && (!q || a.asc.toUpperCase().includes(q)
             || ascDisplayName(this.selection.locus, a.asc).toUpperCase().includes(q)));
  }

  /** A segment chip is a toggle, so clicking the open one clears the filter. */
  toggleSegment(segment: string): void {
    this.ascSegment = this.ascSegment === segment ? '' : segment;
  }

  onSpeciesChange(): void {
    this.selection = { ...this.selection, locus: this.lociFor(this.selection.species)[0],
                       asc: undefined, variant: undefined };
    this.pairingVariant = null;
    this.pairingVariants = [];
    this.pairingFilter = '';
    this.pairingError = null;
    this.loadAscs();
    if (this.view === 'pairing') {
      this.loadPairingVariants();
    }
  }

  onLocusChange(): void {
    // an ASC belongs to a locus, and so does a variant
    this.ascSegment = '';
    this.ascFilter = '';
    this.pairingVariant = null;
    this.pairingVariants = [];
    this.pairingFilter = '';
    this.pairingError = null;
    if (this.view === 'pairing') {
      this.loadPairingVariants();
    }
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

  /**
   * The locus-wide scan used as a variant picker in the variant tab.
   *
   * Deliberately without an ASC, so every point is a variant's strongest result
   * across every gene - which is the right summary when the question is "which
   * variant", not "which variant for this gene". A stored field for the same
   * reason as `plotSelection`: a getter would hand the child a new object on
   * every change-detection pass and it would refetch forever.
   */
  variantPickerSelection: QtlSelection = {};

  /** A point on that map becomes the variant tab's subject. */
  onVariantMapPick(event: { variant: string; asc?: string }): void {
    this.selection = { ...this.selection, variant: event.variant };
    this.plot = undefined;
    this.pointAsc = undefined;
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
        : `No single scan: each variant's best result across every gene in `
          + `${locus ?? 'the locus'}.`;
    }
    if (this.view === 'summary') {
      return 'Every significant variant in the run at once, by which segment\'s '
           + 'genes it explains and what it sits in.';
    }
    if (this.view === 'pairing') {
      return 'Which partner a gene recombines with, and whether a variant '
           + 'moves it. A separate scan from usage, on its own variants.';
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

    const picker = this.variantPickerSelection;
    if (picker.species !== this.selection.species
        || picker.locus !== this.selection.locus) {
      this.variantPickerSelection = { species: this.selection.species,
                                      locus: this.selection.locus };
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
  showView(view: 'gene' | 'variant' | 'pairing' | 'summary'): void {
    this.atGallery = false;
    this.view = view;
    if (view === 'pairing' && !this.pairingVariants.length && !this.pairingError) {
      this.loadPairingVariants();
    }
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

  /** A gene from the summary table opens its own scan. */
  onSummaryGene(hit: { locus: string; asc: string }): void {
    this.onSearchGene(hit);
  }

  /** A gene's strongest variant opens that variant's own table. */
  onSummaryVariant(hit: { locus: string; variant: string }): void {
    this.view = 'variant';
    this.onSearchVariant(hit);
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
        view: this.atGallery ? null : this.view,
        plot: this.plot ?? null,
      pairing: this.pairingVariant ?? null,
      cond: this.pairingConditional === 'P(J|D)' ? null : this.pairingConditional,
      },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  }

  private restoreFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;
    // The cards are up when the URL names no analysis, so a reload or a shared
    // link comes back to them. Writing `view` while they are up would take them
    // straight down again, since writeToUrl re-enters here.
    const asked = params.get('view');
    const known = asked === 'variant' || asked === 'pairing'
                  || asked === 'gene' || asked === 'summary';
    this.atGallery = !known;
    this.view = known ? asked as typeof this.view : 'summary';
    this.plot = params.get('plot') ?? undefined;
    this.pairingVariant = params.get('pairing');
    this.pairingConditional = params.get('cond') === 'P(D|J)' ? 'P(D|J)' : 'P(J|D)';
    this.selection = {
      species: params.get('species') ?? undefined,
      locus: params.get('locus') ?? undefined,
      asc: params.get('asc') ?? undefined,
      variant: params.get('variant') ?? undefined,
    };
  }
}
