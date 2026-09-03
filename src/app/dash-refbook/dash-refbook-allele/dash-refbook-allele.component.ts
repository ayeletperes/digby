import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { PlotlyModule } from 'angular-plotly.js';
import * as UpSetJS from '@upsetjs/bundle';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import {
  DATA_SOURCES, DATA_SOURCE_LABELS, DataSource, SpeciesGeneSelection,
  allelesParam, projectsParam, samplesParam, sourcesParam,
} from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { PlotExportComponent } from '../../shared/plot-export/plot-export.component';

interface Partner {
  name: string;
  samples: number;
  share: number;
}

/** One sample as the zygosity endpoint returns it. */
interface ZygSample {
  name: string;
  sets: string[];
}

/** The two databases keep their app-wide colours so the panel reads like the rest. */
const SOURCE_STYLE: Record<DataSource, { fill: string; line: string }> = {
  genomic: { fill: '#a9e1d4', line: '#8dd3c7' },
  airrseq: { fill: '#ffa07a', line: '#fa946b' },
};

/** Rough width of one character of an UpSet set label at its font size. */
const LABEL_CHAR_PX = 6.2;
/** Most of the chart the labels may take before it is widened instead. */
const MAX_LABEL_SHARE = 0.34;
/** Share given to the per-set bar chart, left of the labels. */
const SET_CHART_SHARE = 0.18;

/** One allele, end to end. */
@Component({
  selector: 'app-dash-refbook-allele',
  templateUrl: './dash-refbook-allele.component.html',
  styleUrls: ['./dash-refbook-allele.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule, ScopeNoteComponent, PlotExportComponent],
})
export class DashRefbookAlleleComponent
  implements OnInit, OnChanges, AfterViewInit, OnDestroy {

  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error: string | null = null;

  allele = '';
  gene = '';

  /** Support: where the allele was seen. */
  genomicAppearances = 0;
  airrseqAppearances = 0;
  isNovel = false;

  /** Whether the project/sample selection actually constrained each database. */
  genomicScoped = false;
  airrseqScoped = false;

  /** Usage across samples. */
  usageCount = 0;
  usageMedian: number | null = null;
  usageMin: number | null = null;
  usageMax: number | null = null;

  /** Usage values tagged with the project they came from. */
  usageByProject: { project: string; value: number }[] = [];

  /** Carriers and what they also carry. */
  carriers = 0;
  partners: Partner[] = [];
  aloneCount = 0;

  /** Projects appearing on the carrier bar, in the order they are drawn. */
  carrierProjects: string[] = [];

  /** Sequence against the gene's reference. */
  alignment = '';

  /** Carriers per project, one bar per database. */
  carrierPlot: unknown[] = [];
  carrierLayout: Record<string, unknown> = {};

  /** Usage per project, so a project that behaves differently is visible. */
  usagePlot: unknown[] = [];
  usageLayout: Record<string, unknown> = {};

  readonly plotConfig = { responsive: true, displaylogo: false, displayModeBar: false };

  /** Carriers of this allele per project, per database. */
  private carrierCounts: Record<DataSource, Map<string, number>> =
    { genomic: new Map(), airrseq: new Map() };

  /** Samples held per project, per database: the hover denominator. */
  private projectTotals: Record<DataSource, Map<string, number>> =
    { genomic: new Map(), airrseq: new Map() };

  /** UpSet input: one carrier, and the OTHER alleles of this gene it carries. */
  coOccurrence: ZygSample[] = [];

  private resizeObs?: ResizeObserver;
  private renderHandle?: ReturnType<typeof setTimeout>;

  constructor(private refbookService: RefbookService, private drill: DashDrillService,
              private host: ElementRef<HTMLElement>) {}

  ngOnInit() { this.fetch(); }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetch();
    }
  }

  ngAfterViewInit() {
    // the card is only in the DOM once an allele has loaded, so observe the host:
    const el = this.host.nativeElement;
    if ('ResizeObserver' in window) {
      this.resizeObs = new ResizeObserver(() => this.scheduleRender());
      this.resizeObs.observe(el);
    }
    this.scheduleRender();
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    clearTimeout(this.renderHandle);
  }

  /** Step back up to the gene, keeping everything else in place. */
  clearAllele() {
    this.drill.drill('allele', this.allele);
  }

  private fetch() {
    const { species, chain, asc } = this.selection ?? {};
    const allele = this.selection?.alleles?.[0];

    if (!species || !chain || !asc || !allele) {
      this.allele = '';
      return;
    }

    this.allele = allele;
    this.gene = asc;
    this.isFetching = true;
    this.error = null;

    const sources = sourcesParam(this.selection);
    const projects = projectsParam(this.selection);
    const samples = samplesParam(this.selection);
    const alleles = allelesParam(this.selection);
    const soften = <T>(fallback: T) => catchError(() => of(fallback));

    const wanted = this.selection?.sources?.length ? this.selection.sources : DATA_SOURCES;
    // one call per database rather than one combined call: the combined response
    const zygosity = (source: DataSource) => (wanted.includes(source)
      ? this.refbookService.getAscZygosity(species, chain, asc, projects, samples,
                                           undefined, source)
          .pipe(soften({ samples: [] }))
      : of({ samples: [] as ZygSample[] }));

    forkJoin({
      overview: this.refbookService.getAscsOverview(species, chain, asc, sources, alleles, projects, samples)
        .pipe(soften({ alleles: [], genomic_counts: [], vdjbase_counts: [], novel: 0, scoped: {} })),
      usage: this.refbookService.getAscUsage(species, chain, asc, projects, samples, alleles)
        .pipe(soften({ alleles: [] })),
      // deliberately unfiltered by allele: the point is what this allele's carriers
      genomic: zygosity('genomic'),
      airrseq: zygosity('airrseq'),
      // per-project sample counts, the denominator behind the carrier percentages
      projects: this.refbookService.getProjects(species, chain, sources)
        .pipe(soften({ projects: [] })),
      alignment: this.refbookService.getAscAlignment(species, chain, asc, 20, sources, alleles)
        .pipe(soften<{ alignment: string }>({ alignment: '' })),
    })
      .pipe(catchError(err => {
        this.error = err?.message ?? 'Could not load this allele';
        this.isFetching = false;
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.readSupport(result.overview);
        this.readUsage(result.usage);
        this.readProjects(result.projects);
        this.readCarriers({ genomic: result.genomic, airrseq: result.airrseq });
        this.buildPlots();
        this.alignment = (result.alignment as { alignment?: string })?.alignment ?? '';
        this.scheduleRender();
      });
  }

  private readSupport(overview: { alleles?: string[]; genomic_counts?: number[];
                                  vdjbase_counts?: number[]; novel?: number;
                                  scoped?: { genomic?: boolean; airrseq?: boolean } }) {
    const index = (overview.alleles ?? []).indexOf(this.allele);
    const at = (values?: number[]) => (index >= 0 ? values?.[index] ?? 0 : 0);

    // the stacked-bar series cannot give these: `both` is a minimum of the two,
    this.genomicAppearances = at(overview.genomic_counts);
    this.airrseqAppearances = at(overview.vdjbase_counts);
    this.isNovel = (overview.novel ?? 0) > 0;
    this.genomicScoped = !!overview.scoped?.genomic;
    this.airrseqScoped = !!overview.scoped?.airrseq;
  }

  private readUsage(usage: { alleles?: { name: string; usage: string[]; samples?: string[] }[] }) {
    const record = (usage.alleles ?? []).find(a => a.name === this.allele);

    this.usageByProject = (record?.usage ?? []).map((raw, i) => ({
      project: this.projectOf(record?.samples?.[i] ?? ''),
      value: Number(raw),
    })).filter(entry => !Number.isNaN(entry.value) && entry.project);

    const values = (record?.usage ?? []).map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);

    this.usageCount = values.length;
    this.usageMin = values.length ? values[0] : null;
    this.usageMax = values.length ? values[values.length - 1] : null;
    this.usageMedian = values.length ? values[Math.floor(values.length / 2)] : null;
  }

  /** How many samples each database holds per project: the carrier denominator. */
  private readProjects(response: { projects?: { name: string;
                                                by_source?: Partial<Record<DataSource, number>> }[] }) {
    this.projectTotals = { genomic: new Map(), airrseq: new Map() };

    for (const project of response.projects ?? []) {
      for (const source of DATA_SOURCES) {
        const total = project.by_source?.[source];
        if (typeof total === 'number') {
          this.projectTotals[source].set(project.name, total);
        }
      }
    }
  }

  private readCarriers(bySource: Record<DataSource, { samples?: ZygSample[] }>) {
    // the same subject can be in both databases (rhesus) or in neither's cohort
    const union = new Map<string, Set<string>>();
    this.carrierCounts = { genomic: new Map(), airrseq: new Map() };

    for (const source of DATA_SOURCES) {
      for (const sample of bySource[source]?.samples ?? []) {
        const sets = union.get(sample.name) ?? new Set<string>();
        (sample.sets ?? []).forEach(name => sets.add(name));
        union.set(sample.name, sets);

        if ((sample.sets ?? []).includes(this.allele)) {
          // sample names are project-prefixed (P11_I10_S1), which is the only
          const project = this.projectOf(sample.name);
          const counts = this.carrierCounts[source];
          counts.set(project, (counts.get(project) ?? 0) + 1);
        }
      }
    }

    const carrying = [...union.entries()].filter(([, sets]) => sets.has(this.allele));

    this.carriers = carrying.length;
    this.aloneCount = carrying.filter(([, sets]) => sets.size === 1).length;

    const byPartner = new Map<string, number>();
    for (const [, sets] of carrying) {
      for (const other of sets) {
        if (other !== this.allele) {
          byPartner.set(other, (byPartner.get(other) ?? 0) + 1);
        }
      }
    }

    this.partners = [...byPartner.entries()]
      .map(([name, samples]) => ({ name, samples, share: carrying.length ? samples / carrying.length : 0 }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, 12);

    // The focal allele stays in the set. Stripping it dropped every carrier whose
    this.coOccurrence = carrying.map(([name, sets]) => ({
      name,
      sets: [...sets].sort(),
    }));

    // projects on the bar, busiest first, counting both databases
    const totalIn = (project: string) =>
      (this.carrierCounts.genomic.get(project) ?? 0) + (this.carrierCounts.airrseq.get(project) ?? 0);

    this.carrierProjects = [...new Set([
      ...this.carrierCounts.genomic.keys(), ...this.carrierCounts.airrseq.keys(),
    ])].sort((a, b) => totalIn(b) - totalIn(a) || a.localeCompare(b));
  }

  /** The name is project-prefixed (P11_I10_S1); nothing else carries the project. */
  private projectOf(sample: string): string {
    return sample.split('_')[0];
  }

  private buildPlots(): void {
    const base = {
      margin: { l: 46, r: 12, t: 8, b: 34 },
      height: 190,
      autosize: true,
      showlegend: false,
      font: { size: 11 },
    };

    this.carrierPlot = DATA_SOURCES.map(source => {
      const label = DATA_SOURCE_LABELS[source];
      const counts = this.carrierProjects.map(project =>
        (this.projectTotals[source].has(project) || this.carrierCounts[source].has(project)
          ? this.carrierCounts[source].get(project) ?? 0
          : null));

      return {
        type: 'bar',
        name: label,
        x: this.carrierProjects,
        // null, not 0: a database that does not hold the project has no bar to
        y: counts,
        customdata: this.carrierProjects.map(project =>
          this.carrierText(project, this.carrierCounts[source].get(project) ?? 0,
                           this.projectTotals[source].get(project))),
        marker: { color: SOURCE_STYLE[source].fill,
                  line: { color: SOURCE_STYLE[source].line, width: 1 } },
        hovertemplate: `%{customdata}<extra>${label}</extra>`,
      };
    // A database that holds none of these projects has no bar anywhere, and
    }).filter(trace => trace.y.some(count => count !== null));
    this.carrierLayout = {
      ...base,
      barmode: 'group',
      // room above the plot for the legend to sit in, rather than on the bars
      margin: { ...base.margin, t: 30 },
      showlegend: true,
      // anchored to the figure, not to the plotting area: "just above the plot"
      legend: { orientation: 'h', x: 0, xanchor: 'left', font: { size: 10 },
                yref: 'container', y: 1, yanchor: 'top' },
      xaxis: { title: { text: 'Project' }, type: 'category', automargin: true },
      yaxis: { title: { text: 'Samples carrying the allele' }, rangemode: 'tozero', automargin: true },
    };

    // one box per project: a project whose usage sits apart is the thing worth
    const projects = [...new Set(this.usageByProject.map(u => u.project))].sort();
    this.usagePlot = projects.map(project => ({
      type: 'box',
      name: project,
      y: this.usageByProject.filter(u => u.project === project).map(u => u.value),
      boxpoints: 'all',
      jitter: 0.4,
      pointpos: 0,
      marker: { size: 5, opacity: 0.55 },
      hovertemplate: '%{y:.3%}<extra>' + project + '</extra>',
    }));
    this.usageLayout = {
      ...base, height: 210,
      xaxis: { title: { text: 'Project' }, automargin: true },
      yaxis: { title: { text: 'Relative usage (%)' }, tickformat: '.1%', rangemode: 'tozero',
               automargin: true },
    };
  }

  /** "12 of 152 samples in P25 (7.9%)", or the bare count when there is no total. */
  private carrierText(project: string, carrying: number, total?: number): string {
    if (!total) {
      return `${carrying} of ? samples in ${project}`;
    }
    return `${carrying} of ${total} samples in ${project} (${(carrying / total * 100).toFixed(1)}%)`;
  }

  private get upsetContainer(): HTMLDivElement | null {
    return this.host.nativeElement.querySelector('.co-upset');
  }

  private scheduleRender() {
    // Coalesced with a timer rather than requestAnimationFrame: rAF does not fire
    clearTimeout(this.renderHandle);
    this.renderHandle = setTimeout(() => this.renderUpset(), 0);
  }

  private renderUpset() {
    const el = this.upsetContainer;
    if (!el) {
      return;
    }

    const withPartners = this.coOccurrence.filter(sample => sample.sets.length);
    const width = el.clientWidth;
    if (!withPartners.length || !width) {
      el.innerHTML = '';    // laid out in a hidden tab; the observer fires when shown
      return;
    }

    try {
      // distinct, not plain, intersections: with the focal allele back in the
      const { sets, combinations } = UpSetJS.extractCombinations(withPartners, {
        type: 'distinctIntersection',
      } as never);

      // Height is split between the combination chart on top and the matrix
      const COMBO_PX = 150;
      const matrixPx = Math.max(56, sets.length * 24 + 28);
      const height = Math.min(520, COMBO_PX + matrixPx);
      const comboShare = COMBO_PX / height;

      // Allele names are long (IGHV1-2*02_c135t and worse) and the default label
      const longest = sets.reduce((n, set) => Math.max(n, (set.name ?? '').length), 0);
      const labelPx = Math.min(300, Math.max(80, longest * LABEL_CHAR_PX));
      const drawWidth = Math.max(width, Math.round(labelPx / MAX_LABEL_SHARE));

      el.style.height = `${height}px`;
      el.innerHTML = '';
      UpSetJS.renderUpSet(el, {
        sets, combinations, width: drawWidth, height,
        widthRatios: [SET_CHART_SHARE, labelPx / drawWidth],
        heightRatios: [comboShare],
        fontSizes: { setLabel: '9px', axisTick: '8px', chartLabel: '10px' },
        onClick: (selected) => {
          const chosen = selected as unknown as { name?: string; type?: string };
          if (chosen?.type === 'set' && chosen.name) {
            this.drill.drill('allele', chosen.name);
          }
        },
      });
    } catch (e) {
      // a render that throws inside the scheduled callback leaves an empty box and
      this.error = `Could not draw the co-occurrence plot: ${(e as Error)?.message ?? e}`;
      el.innerHTML = '';
    }
  }

  openPartner(name: string) {
    this.drill.drill('allele', name);
  }

  /** True when a project or sample filter is narrowing every figure on this page. */
  get isFiltered(): boolean {
    return !!(this.selection?.projects?.length || this.selection?.samples?.length);
  }

  percent(value: number | null): string {
    return value === null ? '–' : `${(value * 100).toFixed(2)}%`;
  }
}
