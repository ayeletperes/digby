import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { EMPTY, Subject, Subscription, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, takeUntil } from 'rxjs/operators';

import {
  DataSource, DATA_SOURCES, DATA_SOURCE_LABELS,
  SourceAvailability, SpeciesGeneSelection, sourcesParam, projectsParam, samplesParam,
  countFilterExcludesAll,
} from '../shared/models/species-gene-selection.model';
import { DASH_PANELS, DashPanel, PANEL_GROUPS, panelBlockedReason } from './dash-panels';
import { segmentLabel, segmentsIn } from '../shared/models/gene-naming';
import { CheckDropdownComponent, CheckOption } from './check-dropdown/check-dropdown.component';
import { GenePickerComponent } from './gene-picker/gene-picker.component';
import { GeneTableSelectorComponent } from '../gene-table-selector/gene-table-selector.component';
import { GeneTableSelectorService } from '../gene-table-selector/gene-table-selector.service';
import { GeneTableSelection } from '../gene-table-selector/gene-table-selector.model';
import { RefbookService } from '../../../projects/digby-swagger-client/api/refbook.service';
import { DashDrillService, DrillEvent } from './dash-drill.service';
import { PanelGalleryComponent } from '../shared/panel-gallery/panel-gallery.component';

/** Genes pre-selected when a locus is opened, so the first panel has something to show. */
const DEFAULT_GENE_COUNT = 1;

/** Most panels draw one chart per gene, so the selection is capped: beyond a few genes the faceted view stops being readable and the request count grows with it. */
const MAX_GENES = 3;

@Component({
  selector: 'app-dash-refbook',
  templateUrl: './dash-refbook.component.html',
  styleUrls: ['./dash-refbook.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, NgbModule,
            GeneTableSelectorComponent, GenePickerComponent, CheckDropdownComponent, PanelGalleryComponent],
  providers: [{ provide: RefbookService, useClass: RefbookService }, DashDrillService],
})
export class DashRefbookComponent implements OnInit, OnDestroy {
  readonly panels = DASH_PANELS;
  readonly panelGroups = PANEL_GROUPS;

  /** The rail collapses so a plot can use the full width when needed. */
  railOpen = true;
  readonly dataSources = DATA_SOURCES;
  readonly sourceLabels = DATA_SOURCE_LABELS;

  selection: SpeciesGeneSelection = { species: undefined, chain: undefined, asc: undefined,
                                      sources: [...DATA_SOURCES], ascs: [] };

  /** What the locus holds, independent of what the user asked for. */
  available = new SourceAvailability();

  /** Every gene in the locus, before the segment narrows it. */
  allAscs: string[] = [];
  availableAscs: string[] = [];

  /** Segment is chosen alongside species and locus, not inside the gene list. */
  segment: string | null = null;
  segments: { code: string; count: number }[] = [];
  readonly segmentLabel = segmentLabel;

  /** AIRR-seq projects and samples, used to narrow the sample-based panels. */
  projects: { name: string; accession: string; samples: number; sources?: string[] }[] = [];
  samples: { name: string; project: string; sources?: string[] }[] = [];
  /** Empty means no filtering, which is how the API reads an absent parameter. */
  selectedProjects: string[] = [];
  selectedSamples: string[] = [];
  selectedAlleles: string[] = [];

  // ---------------------------------------------------------- seen-in filter

  /** Per-allele sample counts for the genes on screen, and the thresholds set against them. */
  alleleCounts: { name: string; genomic: number; airrseq: number }[] = [];
  minGenomic = 0;
  minAirrseq = 0;

  /** The slider moves between stops, not over the raw range. */
  genomicStops: number[] = [0];
  airrseqStops: number[] = [0];
  genomicIndex = 0;
  airrseqIndex = 0;

  private stopsFor(max: number): number[] {
    if (max <= 12) {
      return Array.from({ length: max + 1 }, (_, i) => i);
    }
    const ladder = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500];
    const stops = ladder.filter(v => v < max);
    stops.push(max);
    return stops;
  }

  /** Rebuild the stops for the current maxima, keeping the thresholds put. */
  private rebuildStops(): void {
    this.genomicStops = this.stopsFor(this.maxGenomic);
    this.airrseqStops = this.stopsFor(this.maxAirrseq);
    this.genomicIndex = this.nearestStop(this.genomicStops, this.minGenomic);
    this.airrseqIndex = this.nearestStop(this.airrseqStops, this.minAirrseq);
    this.minGenomic = this.genomicStops[this.genomicIndex];
    this.minAirrseq = this.airrseqStops[this.airrseqIndex];
  }

  private nearestStop(stops: number[], value: number): number {
    let best = 0;
    stops.forEach((v, i) => {
      if (Math.abs(v - value) < Math.abs(stops[best] - value)) { best = i; }
    });
    return best;
  }

  /** Live as the handle moves, so the readout tracks the drag. */
  onStopInput(which: 'genomic' | 'airrseq'): void {
    if (which === 'genomic') {
      this.minGenomic = this.genomicStops[this.genomicIndex] ?? 0;
    } else {
      this.minAirrseq = this.airrseqStops[this.airrseqIndex] ?? 0;
    }
  }

  get maxGenomic(): number {
    return this.alleleCounts.reduce((n, a) => Math.max(n, a.genomic), 0);
  }
  get maxAirrseq(): number {
    return this.alleleCounts.reduce((n, a) => Math.max(n, a.airrseq), 0);
  }
  /** Only offered for a database the user is actually reading. */
  get showGenomicRange(): boolean {
    return this.isSourceOn('genomic') && this.maxGenomic > 1;
  }
  get showAirrseqRange(): boolean {
    return this.isSourceOn('airrseq') && this.maxAirrseq > 1;
  }
  get countFilterActive(): boolean {
    return (this.showGenomicRange && this.minGenomic > 0)
        || (this.showAirrseqRange && this.minAirrseq > 0);
  }
  /** A threshold is set and nothing clears it, so every panel would be empty. */
  get nothingPassesFilter(): boolean {
    return countFilterExcludesAll(this.selection);
  }

  get passingCount(): number {
    return this.passingAlleles()?.length ?? this.alleleCounts.length;
  }

  /** Fired on the range input's `change`, not its `input`, so the panels rebuild once when the handle is released rather than on every pixel of the drag. */
  onSeenInChange(): void {
    this.applySampleFilters();
  }

  resetSeenIn(): void {
    this.minGenomic = 0;
    this.minAirrseq = 0;
    this.genomicIndex = 0;
    this.airrseqIndex = 0;
    this.applySampleFilters();
  }

  /** Allele names clearing every active threshold, or undefined when none is set. */
  private passingAlleles(): string[] | undefined {
    if (!this.countFilterActive) {
      return undefined;
    }
    return this.alleleCounts
      .filter(a => (!this.showGenomicRange || a.genomic >= this.minGenomic)
                && (!this.showAirrseqRange || a.airrseq >= this.minAirrseq))
      .map(a => a.name);
  }

  ascLoading = false;
  ascError: string | null = null;
  /** The segment of each gene, as the databases record it. */
  segmentByGene: Record<string, string> = {};
  /** The panel to land on. */
  activePanelId = (DASH_PANELS.find(panel => !panel.needsAllele) ?? DASH_PANELS[0]).id;

  /** Loaded panel components, keyed by panel id. */
  loaded: Record<string, unknown> = {};

  readonly maxGenes = MAX_GENES;

  /** Which panels have their explanatory caption expanded. */
  captionOpen: Record<string, boolean> = {};

  /** The selection controls collapse once genes are chosen: expanded they take most of the viewport, which leaves no room for the plots they configure. */
  pickerOpen = false;

  /** The card gallery, shown in place of a panel. */
  showGallery = false;

  /** One selection object per gene, reused between change detection runs. */
  private facetCache = new Map<string, SpeciesGeneSelection>();

  /** Genes named in the URL, held until the gene list for the locus arrives. */
  private pendingAscs: string[] = [];

  private destroy$ = new Subject<void>();
  private geneTableSubscription: Subscription;
  private ascLoadSubject = new Subject<{ species: string; locus: string }>();

  constructor(
    private geneTableService: GeneTableSelectorService,
    private refbookService: RefbookService,
    private route: ActivatedRoute,
    private router: Router,
    private drillService: DashDrillService,
  ) {
    this.ascLoadSubject
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe(({ species, locus }) => this.loadAscs(species, locus));
  }

  ngOnInit(): void {
    this.restoreFromUrl();
    this.watchHistory();

    this.geneTableSubscription = this.geneTableService.selection
      .pipe(takeUntil(this.destroy$))
      .subscribe((geneSelection: GeneTableSelection) => this.onDatasetChange(geneSelection));

    this.panels.forEach(panel => panel.load().then(component => this.loaded[panel.id] = component));

    this.drillService.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => this.applyDrill(event));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.geneTableSubscription?.unsubscribe();
  }

  // ---------------------------------------------------------------- panels

  /** Act on a click inside a panel. */
  private applyDrill(event: DrillEvent): void {
    // a drill is a request for a particular view, so it leaves the cards behind
    this.showGallery = false;

    if (event.kind === 'allele') {
      const alreadyOpen = this.selectedAlleles.includes(event.value);

      // one allele at a time: this opens a view of that allele rather than
      this.selectedAlleles = alreadyOpen ? [] : [event.value];

      // clicking an allele means "show me this allele", so go to the panel that
      if (!alreadyOpen) {
        this.activePanelId = 'allele';
      } else if (this.activePanelId === 'allele') {
        this.activePanelId = 'overview';
      }

      this.applySampleFilters();

    } else if (event.kind === 'sample') {
      if (!this.selectedSamples.includes(event.value)) {
        this.onSamplesChange([...this.selectedSamples, event.value]);
      }

    } else if (event.kind === 'gene') {
      // a locus-wide panel has no gene scope of its own, so a gene arriving from
      const fromLocusWide = this.activePanel?.multi;
      this.applyAscs([event.value], true);
      if (fromLocusWide) {
        this.selectedAlleles = [];
        this.activePanelId = 'overview';
        this.applySampleFilters();
      }
    }
  }

  /** Open one gene on its own, from a facet heading. */
  focusGene(gene: string): void {
    this.applyAscs([gene], true);
  }

  toggleCaption(id: string): void {
    this.captionOpen = { ...this.captionOpen, [id]: !this.captionOpen[id] };
  }

  /** True when the open panel is drawn from the whole locus, so the gene and sample controls in the rail do not reach it. */
  get railScoped(): boolean {
    return !!this.activePanel?.multi;
  }

  get scopedNote(): string {
    return `not used by the ${this.activePanel?.label?.toLowerCase() ?? 'panel'}`;
  }

  blockedReason(panel: DashPanel): string | null {
    return panelBlockedReason(panel, this.selection.sources ?? [], this.available,
                              this.selection.ascs?.length ?? 0, this.selectedAlleles.length);
  }

  panelsIn(group: string): DashPanel[] {
    return this.panels.filter(panel => panel.group === group);
  }

  get activePanel(): DashPanel {
    return this.panels.find(panel => panel.id === this.activePanelId) ?? this.panels[0];
  }

  /** From the gallery, which speaks its own minimal panel shape so a second dashboard can use it without adopting DashPanel. */
  openFromGallery(panel: { id: string }): void {
    const found = this.panels.find(p => p.id === panel.id);
    if (found) {
      this.selectPanel(found);
    }
  }

  selectPanel(panel: DashPanel): void {
    if (this.blockedReason(panel)) {
      return;
    }
    this.activePanelId = panel.id;
    this.showGallery = false;
    this.writeToUrl();
  }

  /** Set when the chosen locus has nothing here, which the shared dataset selector cannot know: it offers every dataset, and IGHC is one the Explorer. */
  get locusUnavailable(): string | null {
    return this.ascError && !this.availableAscs.length ? this.ascError : null;
  }

  /** Bound into the gallery, which asks per card rather than holding the rule. */
  readonly galleryBlocked = (panel: DashPanel): string | null => this.blockedReason(panel);

  /** Back to the cards, without losing the species, locus or filters. */
  openGallery(): void {
    this.showGallery = true;
    // drops `panel` from the URL, so a reload or a shared link comes back here
    this.writeToUrl();
  }

  /** The filters currently narrowing the view, as removable chips. */
  get activeChips(): { key: string; label: string; value: string }[] {
    const chips: { key: string; label: string; value: string }[] = [];

    if (this.segment) {
      chips.push({ key: 'segment', label: 'Segment', value: this.segmentLabel(this.segment) });
    }
    const sources = this.selection.sources ?? [];
    if (sources.length === 1) {
      chips.push({ key: 'source', label: 'Data', value: this.sourceLabels[sources[0]] });
    }
    for (const project of this.selectedProjects) {
      chips.push({ key: `project:${project}`, label: 'Project', value: project });
    }
    for (const sample of this.selectedSamples) {
      chips.push({ key: `sample:${sample}`, label: 'Sample', value: sample });
    }
    for (const gene of this.selection.ascs ?? []) {
      chips.push({ key: `gene:${gene}`, label: 'Gene', value: gene });
    }
    for (const allele of this.selectedAlleles) {
      chips.push({ key: `allele:${allele}`, label: 'Allele', value: allele });
    }
    return chips;
  }

  removeChip(key: string): void {
    const [kind, value] = key.split(':');

    if (kind === 'segment') {
      this.segment = null;
      this.onSegmentChange();
    } else if (kind === 'source') {
      this.selection = { ...this.selection, sources: [...DATA_SOURCES] };
      this.facetCache.clear();
      this.loadProjects();
      this.writeToUrl();
    } else if (kind === 'project') {
      this.onProjectsChange(this.selectedProjects.filter(p => p !== value));
    } else if (kind === 'sample') {
      this.onSamplesChange(this.selectedSamples.filter(s => s !== value));
    } else if (kind === 'gene') {
      this.applyAscs((this.selection.ascs ?? []).filter(g => g !== value), true);
    } else if (kind === 'allele') {
      this.selectedAlleles = this.selectedAlleles.filter(a => a !== value);
      this.applySampleFilters();
    }
  }

  // ---------------------------------------------------------------- sources

  isSourceOn(source: DataSource): boolean {
    return (this.selection.sources ?? []).includes(source);
  }

  isSourceAvailable(source: DataSource): boolean {
    return source === 'genomic' ? this.available.genomic : this.available.airrseq;
  }

  toggleSource(source: DataSource): void {
    const current = new Set(this.selection.sources ?? []);
    current.has(source) ? current.delete(source) : current.add(source);

    // turning everything off would leave every panel blocked and no way back
    if (!current.size) {
      return;
    }

    this.selection = { ...this.selection, sources: DATA_SOURCES.filter(s => current.has(s)) };
    this.facetCache.clear();
    // the two databases hold different studies, so the lists have to be refetched
    this.loadProjects();
    this.writeToUrl();
    // a database that is no longer read must not keep filtering
    this.loadAlleleCounts();
  }

  // ------------------------------------------------------------------ genes

  isAscSelected(asc: string): boolean {
    return (this.selection.ascs ?? []).includes(asc);
  }

  onGenesChange(ascs: string[]): void {
    this.applyAscs(ascs, true);
    // reaching the cap means the picker has nothing more to offer
    if (ascs.length >= MAX_GENES) {
      this.pickerOpen = false;
    }
  }

  /** Sample filters mean something for whichever database is being read. */
  get sampleFiltersEnabled(): boolean {
    return (this.selection.sources ?? []).some(source => this.isSourceAvailable(source));
  }

  /** The database an entry belongs to, used as its heading. */
  private sourceGroup(sources?: string[]): string {
    const named = (sources ?? []).map(s => this.sourceLabels[s] ?? s);
    return named.length ? named.join(' + ') : 'Unknown';
  }

  get projectOptions(): CheckOption[] {
    return this.projects.map(p => ({
      value: p.name,
      label: p.name,
      detail: p.samples,
      group: this.sourceGroup(p.sources),
    }));
  }

  get sampleOptions(): CheckOption[] {
    return this.samples.map(s => ({
      value: s.name,
      label: s.name,
      detail: s.project,
      group: this.sourceGroup(s.sources),
    }));
  }

  onProjectsChange(projects: string[]): void {
    this.selectedProjects = projects;
    // samples are listed per project, so a narrowed project set can strand a
    this.loadSamples();
    this.applySampleFilters();
  }

  onSamplesChange(samples: string[]): void {
    this.selectedSamples = samples;
    this.applySampleFilters();
  }

  /** Split the selected projects by the database that holds them. */
  private projectScope(): { genomic: string[]; airrseq: string[] } {
    const scope = { genomic: [] as string[], airrseq: [] as string[] };

    for (const name of this.selectedProjects) {
      const known = this.projects.find(p => p.name === name);
      for (const source of known?.sources ?? []) {
        if (source === 'genomic' || source === 'airrseq') {
          scope[source].push(name);
        }
      }
    }
    return scope;
  }

  /** Per-allele counts for the genes on screen, which is what the sliders span. */
  private loadAlleleCounts(): void {
    const { species, chain } = this.selection;
    const genes = this.selection.ascs ?? [];
    if (!species || !chain || !genes.length) {
      this.alleleCounts = [];
      return;
    }

    const sources = sourcesParam(this.selection);
    forkJoin(genes.map(gene =>
      this.refbookService.getAscsOverview(species, chain, gene, sources,
                                          undefined, projectsParam(this.selection),
                                          samplesParam(this.selection))
        .pipe(catchError(() => of(null)))))
      .pipe(takeUntil(this.destroy$))
      .subscribe(results => {
        const counts: { name: string; genomic: number; airrseq: number }[] = [];
        for (const r of results as ({ alleles?: string[]; genomic_counts?: number[];
                                      vdjbase_counts?: number[] } | null)[]) {
          (r?.alleles ?? []).forEach((name, i) => counts.push({
            name,
            genomic: r?.genomic_counts?.[i] ?? 0,
            airrseq: r?.vdjbase_counts?.[i] ?? 0,
          }));
        }
        this.alleleCounts = counts;
        this.minGenomic = Math.min(this.minGenomic, this.maxGenomic);
        this.minAirrseq = Math.min(this.minAirrseq, this.maxAirrseq);
        this.rebuildStops();
        this.applySampleFilters();
      });
  }

  private applySampleFilters(): void {
    this.selection = {
      ...this.selection,
      projects: [...this.selectedProjects],
      samples: [...this.selectedSamples],
      alleles: [...this.selectedAlleles],
      countFilter: this.passingAlleles(),
      projectScope: this.projectScope(),
    };
    this.facetCache.clear();
    this.writeToUrl();
  }

  private loadProjects(): void {
    const { species, chain } = this.selection;
    if (!species || !chain) {
      this.projects = [];
      return;
    }

    this.refbookService.getProjects(species, chain, sourcesParam(this.selection))
      .pipe(catchError(() => EMPTY), takeUntil(this.destroy$))
      .subscribe((rec: { projects: typeof this.projects }) => {
        this.projects = rec.projects ?? [];

        // the databases hold different studies, so switching source can strand a
        const known = new Set(this.projects.map(p => p.name));
        const kept = this.selectedProjects.filter(name => known.has(name));
        const changed = kept.length !== this.selectedProjects.length;
        this.selectedProjects = kept;

        // the scope is derived from this list, so refresh it even when the
        this.applySampleFilters();
        this.loadSamples();
      });
  }

  private loadSamples(): void {
    const { species, chain } = this.selection;
    if (!species || !chain) {
      this.samples = [];
      return;
    }

    const projects = this.selectedProjects.length ? this.selectedProjects.join(',') : undefined;

    this.refbookService.getSamples(species, chain, projects, sourcesParam(this.selection))
      .pipe(catchError(() => EMPTY), takeUntil(this.destroy$))
      .subscribe((rec: { samples: typeof this.samples }) => {
        this.samples = rec.samples ?? [];
        const known = new Set(this.samples.map(s => s.name));
        const kept = this.selectedSamples.filter(name => known.has(name));

        if (kept.length !== this.selectedSamples.length) {
          this.selectedSamples = kept;
          this.applySampleFilters();
        }
      });
  }

  onSegmentChange(): void {
    this.applySegment();
    // a new segment is a new set of genes, so start it the way a new locus starts
    this.applyAscs(this.availableAscs.slice(0, DEFAULT_GENE_COUNT), true);
  }

  /** Narrow the gene list to the chosen segment, or show all when none is chosen. */
  private applySegment(): void {
    this.availableAscs = this.segment
      ? this.allAscs.filter(gene => this.segmentByGene[gene] === this.segment)
      : [...this.allAscs];
  }

  /** @param clearAlleles pass true when the user chose different genes. */
  private applyAscs(ascs: string[], clearAlleles = false): void {
    const capped = ascs.slice(0, MAX_GENES);

    if (clearAlleles) {
      this.selectedAlleles = [];
    }

    // asc mirrors ascs[0] so single-gene panels keep working unchanged
    this.selection = { ...this.selection, ascs: capped, asc: capped[0],
                       alleles: [...this.selectedAlleles] };
    this.facetCache.clear();
    this.writeToUrl();
    // the sliders span this gene's counts, so they follow the gene
    this.loadAlleleCounts();
  }

  /** The genes a panel should be drawn for: all of them for a panel that compares genes itself, otherwise one facet each. */
  facetsFor(panel: DashPanel): string[] {
    return panel.multi ? [] : (this.selection.ascs ?? []);
  }

  /** The selection a panel reads, stable across change detection. */
  private selectionSeenBy(panel: DashPanel, gene?: string): SpeciesGeneSelection {
    const key = `${gene ?? '*'}|${panel.needsAllele ? 'allele' : 'gene'}`;
    let cached = this.facetCache.get(key);
    if (!cached) {
      cached = { ...this.selection };
      if (!panel.needsAllele) {
        cached.alleles = [];
      }
      if (gene) {
        cached.asc = gene;
        cached.ascs = [gene];
      }
      this.facetCache.set(key, cached);
    }
    return cached;
  }

  /** The whole selection, as a panel that draws every gene at once reads it. */
  selectionForPanel(panel: DashPanel): SpeciesGeneSelection {
    return this.selectionSeenBy(panel);
  }

  /** A single-gene view of the current selection. */
  selectionFor(gene: string): SpeciesGeneSelection {
    return this.selectionSeenBy(this.activePanel, gene);
  }

  // --------------------------------------------------------------- datasets

  private onDatasetChange(geneSelection: GeneTableSelection): void {
    if (!geneSelection.species) {
      return;
    }

    const locus = geneSelection.commonDatasets.length ? geneSelection.commonDatasets[0] : undefined;
    const changed = geneSelection.species !== this.selection.species || locus !== this.selection.chain;

    this.selection = { ...this.selection, species: geneSelection.species, chain: locus };

    if (!locus) {
      this.resetAscs();
      return;
    }

    if (changed) {
      this.ascLoadSubject.next({ species: geneSelection.species, locus });
    }
  }

  private loadAscs(species: string, locus: string): void {
    this.ascLoading = true;
    this.ascError = null;
    this.allAscs = [];
    this.availableAscs = [];

    // deliberately unfiltered: this asks what the locus holds, which is what the
    this.refbookService.getAscsInLocusApi(species, locus)
      .pipe(
        catchError(err => {
          // Clear the old locus's genes before reporting. Without this the
          this.segments = [];
          this.segment = null;
          this.segmentByGene = {};
          this.allAscs = [];
          this.availableAscs = [];
          this.applyAscs([]);
          this.ascError = err?.status === 404
            ? `The Explorer has no data for ${locus}.`
            : 'Could not load the genes for this locus.';
          this.ascLoading = false;
          return EMPTY;
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((rec: { ascs: string[]; segments?: Record<string, string>;
                        genomic: boolean; airr_seq: boolean }) => {
        this.ascLoading = false;
        this.allAscs = rec.ascs ?? [];
        this.segmentByGene = rec.segments ?? {};
        this.segments = segmentsIn(this.allAscs, this.segmentByGene);

        // keep the segment if the new locus has it, else default to the largest
        if (!this.segments.some(s => s.code === this.segment)) {
          this.segment = this.segments.length
            ? [...this.segments].sort((a, b) => b.count - a.count)[0].code
            : null;
        }
        this.applySegment();

        this.available = { genomic: rec.genomic, airrseq: rec.airr_seq };
        this.loadProjects();

        // drop sources this locus does not have, but never end up with none
        const usable = DATA_SOURCES.filter(s => this.isSourceAvailable(s));
        const kept = (this.selection.sources ?? []).filter(s => usable.includes(s));
        this.selection = { ...this.selection, sources: kept.length ? kept : usable };

        // a link naming genes wins; otherwise start the new locus fresh
        const asked = this.pendingAscs.filter(a => this.availableAscs.includes(a));
        this.pendingAscs = [];

        // a link naming both genes and alleles must keep the alleles
        this.applyAscs(asked.length ? asked : this.availableAscs.slice(0, DEFAULT_GENE_COUNT),
                       !asked.length);
      });
  }

  private resetAscs(): void {
    this.allAscs = [];
    this.availableAscs = [];
    this.segments = [];
    this.segment = null;
    this.ascLoading = false;
    this.ascError = null;
    this.applyAscs([]);
  }

  // ------------------------------------------------------------------- URL

  /** Selection lives in the query string so a panel can be linked to and reloaded. */
  private writeToUrl(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        // no panel while the cards are up, so the URL says what is on screen.
        panel: this.showGallery ? null : this.activePanelId,
        segment: this.segment,
        projects: this.selectedProjects.join(',') || null,
        samples: this.selectedSamples.join(',') || null,
        alleles: this.selectedAlleles.join(',') || null,
        sources: (this.selection.sources ?? []).join(',') || null,
        genes: (this.selection.ascs ?? []).join(',') || null,
      },
      queryParamsHandling: 'merge',
      // a real navigation, not a replacement, so browser back steps through the
      replaceUrl: false,
    });
  }

  private restoreFromUrl(): void {
    const params = this.route.snapshot.queryParamMap;

    this.segment = params.get('segment');
    this.selectedProjects = (params.get('projects') ?? '').split(',').filter(Boolean);
    this.selectedSamples = (params.get('samples') ?? '').split(',').filter(Boolean);
    this.selectedAlleles = (params.get('alleles') ?? '').split(',').filter(Boolean);
    this.selection = {
      ...this.selection,
      projects: [...this.selectedProjects],
      samples: [...this.selectedSamples],
      alleles: [...this.selectedAlleles],
    };

    const sources = (params.get('sources') ?? '')
      .split(',').filter((s): s is DataSource => (DATA_SOURCES as string[]).includes(s));
    if (sources.length) {
      this.selection = { ...this.selection, sources };
    }

    const genes = (params.get('genes') ?? '').split(',').filter(Boolean);
    if (genes.length) {
      this.pendingAscs = genes;
      this.selection = { ...this.selection, ascs: genes, asc: genes[0] };
    }

    // Last, because it depends on what the rest of the URL restored. A link may
    const wanted = this.panels.find(panel => panel.id === params.get('panel'));
    if (wanted && !(wanted.needsAllele && !this.selectedAlleles.length)) {
      this.activePanelId = wanted.id;
    }

    // no panel named means nobody has chosen one yet: show what there is to choose
    this.showGallery = !params.get('panel');
  }

  /** Re-read the selection when the browser moves through history. */
  private watchHistory(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreFromUrl());
  }
}
