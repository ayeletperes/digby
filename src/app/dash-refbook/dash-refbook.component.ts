import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { EMPTY, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, takeUntil } from 'rxjs/operators';

import {
  DataSource, DATA_SOURCES, DATA_SOURCE_LABELS,
  SourceAvailability, SpeciesGeneSelection, sourcesParam,
} from '../shared/models/species-gene-selection.model';
import { DASH_PANELS, DashPanel, PANEL_GROUPS, panelBlockedReason } from './dash-panels';
import { segmentLabel, segmentOf, segmentsIn } from '../shared/models/gene-naming';
import { CheckDropdownComponent, CheckOption } from './check-dropdown/check-dropdown.component';
import { GenePickerComponent } from './gene-picker/gene-picker.component';
import { GeneTableSelectorComponent } from '../gene-table-selector/gene-table-selector.component';
import { GeneTableSelectorService } from '../gene-table-selector/gene-table-selector.service';
import { GeneTableSelection } from '../gene-table-selector/gene-table-selector.model';
import { RefbookService } from '../../../projects/digby-swagger-client/api/refbook.service';
import { DashDrillService, DrillEvent } from './dash-drill.service';

/**
 * Genes pre-selected when a locus is opened, so the first panel has something to
 * show. One, not a full set: the landing view should be a single gene read at
 * full size, and comparing two or three is a thing you go on to ask for.
 */
const DEFAULT_GENE_COUNT = 1;

/**
 * Most panels draw one chart per gene, so the selection is capped: beyond a few
 * genes the faceted view stops being readable and the request count grows with it.
 */
export const MAX_GENES = 3;

@Component({
  selector: 'app-dash-refbook',
  templateUrl: './dash-refbook.component.html',
  styleUrls: ['./dash-refbook.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, NgbModule,
            GeneTableSelectorComponent, GenePickerComponent, CheckDropdownComponent],
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

  ascLoading = false;
  ascError: string | null = null;
  /**
   * The panel to land on.
   *
   * The first panel that stands on its own, rather than `DASH_PANELS[0]` - that
   * is the Allele detail, which needs an allele to have been clicked, so a cold
   * load opened on "Click an allele in any plot to open it here" and had nothing
   * to offer until you left it.
   */
  activePanelId = (DASH_PANELS.find(panel => !panel.needsAllele) ?? DASH_PANELS[0]).id;

  /** Loaded panel components, keyed by panel id. */
  loaded: Record<string, unknown> = {};

  readonly maxGenes = MAX_GENES;

  /** Which panels have their explanatory caption expanded. */
  captionOpen: Record<string, boolean> = {};

  /**
   * The selection controls collapse once genes are chosen: expanded they take most
   * of the viewport, which leaves no room for the plots they configure.
   */
  pickerOpen = false;

  /** One-line description of the current selection, shown while collapsed. */
  get selectionSummary(): string {
    const genes = this.selection.ascs ?? [];
    const parts = [this.selection.species, this.selection.chain].filter(Boolean);
    if (this.segment) {
      parts.push(this.segmentLabel(this.segment));
    }
    return [parts.join(' · '), genes.join(', ') || 'no genes selected']
      .filter(Boolean).join('  —  ');
  }

  /**
   * One selection object per gene, reused between change detection runs.
   *
   * Faceted panels take a single-gene selection as an @Input, and a fresh object
   * each time would retrigger their ngOnChanges and refetch on every cycle.
   */
  private facetCache = new Map<string, SpeciesGeneSelection>();

  /**
   * Genes named in the URL, held until the gene list for the locus arrives.
   *
   * The dataset selector emits before that list is known, and the resulting
   * default selection would otherwise overwrite the query string that asked for
   * these, losing the selection on every shared link.
   */
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

  /**
   * Act on a click inside a panel.
   *
   * Clicking something already filtered removes it, so the same click both drills
   * in and backs out, and none of these are destructive: every one lands in the
   * URL and can be undone with the chip or the browser's back button.
   */
  private applyDrill(event: DrillEvent): void {
    if (event.kind === 'allele') {
      const alreadyOpen = this.selectedAlleles.includes(event.value);

      // one allele at a time: this opens a view of that allele rather than
      // narrowing the gene-level plots to a set
      this.selectedAlleles = alreadyOpen ? [] : [event.value];

      // clicking an allele means "show me this allele", so go to the panel that
      // answers that; clicking it again steps back up to where the gene is shown
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
      // zoom from comparing several genes to studying one
      this.applyAscs([event.value], true);
    }
  }

  /** Open one gene on its own, from a facet heading. */
  focusGene(gene: string): void {
    this.applyAscs([gene], true);
  }

  toggleCaption(id: string): void {
    this.captionOpen = { ...this.captionOpen, [id]: !this.captionOpen[id] };
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

  selectPanel(panel: DashPanel): void {
    if (this.blockedReason(panel)) {
      return;
    }
    this.activePanelId = panel.id;
    this.writeToUrl();
  }

  /**
   * The filters currently narrowing the view, as removable chips.
   *
   * Species and locus are omitted: they are not narrowing anything, they are the
   * dataset being looked at, and removing them would leave nothing to show.
   */
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

  /**
   * Sample filters mean something for whichever database is being read.
   *
   * This used to require AIRR-seq, from when only AIRR-seq carried projects and
   * samples. Genomic carries both now - IGH holds 2 genomic projects and 328
   * genomic samples, and the backend filters on them - so a genomic-only view
   * had the two dropdowns greyed out over data that was there all along.
   */
  get sampleFiltersEnabled(): boolean {
    return (this.selection.sources ?? []).some(source => this.isSourceAvailable(source));
  }

  /**
   * The database an entry belongs to, used as its heading.
   *
   * A selection narrows only the database that holds it, so grouping by source is
   * what makes a project or sample list honest about what picking it will do.
   */
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
    // sample that is no longer offered; loadSamples drops those
    this.loadSamples();
    this.applySampleFilters();
  }

  onSamplesChange(samples: string[]): void {
    this.selectedSamples = samples;
    this.applySampleFilters();
  }

  /**
   * Split the selected projects by the database that holds them.
   *
   * A project belongs to one database or the other, so a selection narrows only
   * the database it came from; panels need this to describe their own scope.
   */
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

  private applySampleFilters(): void {
    this.selection = {
      ...this.selection,
      projects: [...this.selectedProjects],
      samples: [...this.selectedSamples],
      alleles: [...this.selectedAlleles],
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
        // project that no longer exists; drop it and tell the panels
        const known = new Set(this.projects.map(p => p.name));
        const kept = this.selectedProjects.filter(name => known.has(name));
        const changed = kept.length !== this.selectedProjects.length;
        this.selectedProjects = kept;

        // the scope is derived from this list, so refresh it even when the
        // selection itself did not change
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
      ? this.allAscs.filter(gene => segmentOf(gene) === this.segment)
      : [...this.allAscs];
  }

  /**
   * @param clearAlleles pass true when the user chose different genes. An allele
   *   belongs to a gene, so it cannot survive that - but this method also runs
   *   from startup and from the dataset selector reporting no locus yet, and
   *   clearing on those discarded any allele restored from the URL.
   */
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
  }

  /**
   * The genes a panel should be drawn for: all of them for a panel that compares
   * genes itself, otherwise one facet each.
   */
  facetsFor(panel: DashPanel): string[] {
    return panel.multi ? [] : (this.selection.ascs ?? []);
  }

  /**
   * The selection a panel reads, stable across change detection.
   *
   * A drilled allele belongs to the panel that asked for it. Every gene-level
   * panel passes `alleles` to the backend, so opening one while an allele was
   * drilled narrowed it to that allele - the Overview of IGHV1-18 came back with
   * 1 allele instead of 18, which is not an overview of anything. The Allele
   * panel's own description already promises the opposite: "the gene-level
   * panels stay as they were, so stepping back up is one click".
   *
   * The allele stays selected, so returning to the Allele panel still has it,
   * and the chip in the filter bar is still the way to drop it entirely.
   *
   * Cached, and keyed on whether the allele is included: handing a child a new
   * object on every change-detection pass makes it refetch forever.
   */
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
    // source toggle and the panel gating are described against
    this.refbookService.getAscsInLocusApi(species, locus)
      .pipe(
        catchError(err => {
          this.ascError = err?.message ?? 'Failed to load genes';
          this.ascLoading = false;
          return EMPTY;
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((rec: { ascs: string[]; genomic: boolean; airr_seq: boolean }) => {
        this.ascLoading = false;
        this.allAscs = rec.ascs ?? [];
        this.segments = segmentsIn(this.allAscs);

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
        panel: this.activePanelId,
        segment: this.segment,
        projects: this.selectedProjects.join(',') || null,
        samples: this.selectedSamples.join(',') || null,
        alleles: this.selectedAlleles.join(',') || null,
        sources: (this.selection.sources ?? []).join(',') || null,
        genes: (this.selection.ascs ?? []).join(',') || null,
      },
      queryParamsHandling: 'merge',
      // a real navigation, not a replacement, so browser back steps through the
      // exploration rather than leaving the dashboard
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
    // name the Allele detail without naming an allele - restoring that literally
    // lands on "click an allele in any plot", the dead end the cold-start
    // default already avoids. Reading `selectedAlleles` before it is filled in
    // would bounce every legitimate allele link too.
    const wanted = this.panels.find(panel => panel.id === params.get('panel'));
    if (wanted && !(wanted.needsAllele && !this.selectedAlleles.length)) {
      this.activePanelId = wanted.id;
    }
  }

  /** Re-read the selection when the browser moves through history. */
  private watchHistory(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.restoreFromUrl());
  }
}
