import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { PlotlyModule } from 'angular-plotly.js';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import {
  SpeciesGeneSelection, allelesParam, projectsParam, samplesParam, sourcesParam,
} from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';

interface Partner {
  name: string;
  samples: number;
  share: number;
}

/**
 * One allele, end to end.
 *
 * The gene-level panels answer "what alleles does this gene have"; filtering one of
 * them to a single allele just leaves a chart with one bar. This is the level below:
 * everything known about a single allele, assembled from the same endpoints the
 * other panels use, each narrowed to it.
 */
@Component({
  selector: 'app-dash-refbook-allele',
  templateUrl: './dash-refbook-allele.component.html',
  styleUrls: ['./dash-refbook-allele.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule, ScopeNoteComponent],
})
export class DashRefbookAlleleComponent implements OnInit, OnChanges {
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
  carriersByProject: { project: string; samples: number }[] = [];
  partners: Partner[] = [];
  aloneCount = 0;

  /** Sequence against the gene's reference. */
  alignment = '';

  /** Carriers per project, as a bar chart rather than a table of numbers. */
  carrierPlot: unknown[] = [];
  carrierLayout: Record<string, unknown> = {};

  /** Usage per project, so a project that behaves differently is visible. */
  usagePlot: unknown[] = [];
  usageLayout: Record<string, unknown> = {};

  readonly plotConfig = { responsive: true, displaylogo: false, displayModeBar: false };

  constructor(private refbookService: RefbookService, private drill: DashDrillService) {}

  ngOnInit() { this.fetch(); }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetch();
    }
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

    forkJoin({
      overview: this.refbookService.getAscsOverview(species, chain, asc, sources, alleles, projects, samples)
        .pipe(soften({ alleles: [], genomic_counts: [], vdjbase_counts: [], novel: 0, scoped: {} })),
      usage: this.refbookService.getAscUsage(species, chain, asc, projects, samples, alleles)
        .pipe(soften({ alleles: [] })),
      // deliberately unfiltered by allele: the point is what this allele's carriers
      // also carry, which an allele-filtered response would hide
      zygosity: this.refbookService.getAscZygosity(species, chain, asc, projects, samples,
                                                   undefined, sources)
        .pipe(soften({ samples: [] })),
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
        this.readCarriers(result.zygosity);
        this.buildPlots();
        this.alignment = (result.alignment as { alignment?: string })?.alignment ?? '';
      });
  }

  private readSupport(overview: { alleles?: string[]; genomic_counts?: number[];
                                  vdjbase_counts?: number[]; novel?: number;
                                  scoped?: { genomic?: boolean; airrseq?: boolean } }) {
    const index = (overview.alleles ?? []).indexOf(this.allele);
    const at = (values?: number[]) => (index >= 0 ? values?.[index] ?? 0 : 0);

    // the stacked-bar series cannot give these: `both` is a minimum of the two,
    // so reconstructing from them reported the smaller figure for both databases
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

  private readCarriers(zygosity: { samples?: { name: string; project?: string; sets: string[] }[] }) {
    const all = zygosity.samples ?? [];
    const carrying = all.filter(sample => sample.sets?.includes(this.allele));

    this.carriers = carrying.length;
    this.aloneCount = carrying.filter(sample => sample.sets.length === 1).length;

    const byProject = new Map<string, number>();
    const byPartner = new Map<string, number>();

    for (const sample of carrying) {
      // sample names are project-prefixed (P11_I10_S1), which is the only project
      // marker the zygosity response carries
      const project = sample.project ?? this.projectOf(sample.name);
      byProject.set(project, (byProject.get(project) ?? 0) + 1);

      for (const other of sample.sets) {
        if (other !== this.allele) {
          byPartner.set(other, (byPartner.get(other) ?? 0) + 1);
        }
      }
    }

    this.carriersByProject = [...byProject.entries()]
      .map(([project, samples]) => ({ project, samples }))
      .sort((a, b) => b.samples - a.samples);

    this.partners = [...byPartner.entries()]
      .map(([name, samples]) => ({ name, samples, share: carrying.length ? samples / carrying.length : 0 }))
      .sort((a, b) => b.samples - a.samples)
      .slice(0, 12);
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

    this.carrierPlot = [{
      type: 'bar',
      x: this.carriersByProject.map(row => row.project),
      y: this.carriersByProject.map(row => row.samples),
      marker: { color: '#188080' },  // brand teal, matching every other chart
      hovertemplate: '%{x}: %{y} subjects<extra></extra>',
    }];
    this.carrierLayout = {
      ...base,
      xaxis: { title: 'Project', automargin: true },
      yaxis: { title: 'Subjects carrying the allele', rangemode: 'tozero', automargin: true },
    };

    // one box per project: a project whose usage sits apart is the thing worth
    // seeing, and a single pooled distribution hides it
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
      xaxis: { title: 'Project', automargin: true },
      yaxis: { title: 'Share of repertoire', tickformat: '.1%', rangemode: 'tozero',
               automargin: true },
    };
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
