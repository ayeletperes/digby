import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { QtlRegionComponent } from '../qtl-region/qtl-region.component';
import { QtlGenotypeCountsComponent } from '../qtl-genotype-counts/qtl-genotype-counts.component';
import { ascDisplayName } from '../../shared/models/gene-naming';
import { ExportTable, exportButtons } from '../../shared/plot-export/plot-export';
import {
  QtlAssociation, QtlFit, QtlSelection, QtlVariant,
} from '../../shared/models/qtl-selection.model';

interface SubjectPoint {
  subject: string;
  genotype: number | null;
  usage: number | null;
}

/** Genotype classes, written the way the genotype is actually reported. */
const GENOTYPE_LABEL: Record<number, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };
const GENOTYPE_COLOUR: Record<number, string> = { 0: '#2a78d6', 1: '#e34948', 2: '#eda100' };

/**
 * What one variant does to one gene's usage.
 *
 * This is the plot behind a Manhattan point. The scan says a variant explains
 * usage of an ASC; this shows the usage it explains, one point per subject,
 * grouped by how many copies of the variant that subject carries.
 */
@Component({
  selector: 'app-qtl-variant',
  templateUrl: './qtl-variant.component.html',
  styleUrls: ['./qtl-variant.component.scss'],
  standalone: true,
  imports: [CommonModule, PlotlyModule, QtlRegionComponent,
            QtlGenotypeCountsComponent],
})
export class QtlVariantComponent implements OnChanges {
  @Input() selection: QtlSelection;
  /** The ASC the clicked point came from, when the scan was a whole-locus one. */
  @Input() fallbackAsc?: string;

  @Output() ascPicked = new EventEmitter<string>();
  /** A neighbour in the region track, handed up so the shell can re-select it. */
  @Output() regionVariantPicked = new EventEmitter<string>();
  /** The way back to the scan this variant was opened from. */
  @Output() backToGene = new EventEmitter<void>();

  readonly ascName = ascDisplayName;

  /**
   * The table used to stop at the strongest 12 of however many genes there are.
   *
   * A silent cap, and a misleading one: the heading says every gene, and with 70
   * genes in IGH it showed a sixth of them with no indication there was a rest.
   * Every row is drawn now, inside a scroll box, with the counts said out loud.
   */
  significantOnly = false;

  get significantCount(): number {
    return this.associations.filter(a => a.significant).length;
  }

  get shownAssociations(): QtlAssociation[] {
    return this.significantOnly
      ? this.associations.filter(a => a.significant) : this.associations;
  }

  isFetching = false;
  error: string | null = null;

  variant: QtlVariant | null = null;
  /**
   * What the world outside VDJbase calls this variant.
   *
   * `applies` is false where the map has nothing to say (the light chains are
   * already on chromosome coordinates); `mapped` is false where it applies and
   * the variant is simply not in dbSNP. Two different answers, and only the
   * second one is "no identifier".
   */
  dbsnp: { mapped: boolean; applies: boolean; rsids: string[];
           grch38: { contig: string; pos: number } | null;
           source: string | null } | null = null;
  associations: QtlAssociation[] = [];
  subjects: SubjectPoint[] = [];
  association: QtlFit | null = null;
  hasGenotypes = false;

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};

  /** Group sizes, shown beside the boxes: a class of five is not a distribution. */
  /**
   * The usage boxplot's own table.
   *
   * Its traces hold one usage value per subject in `y`, with the genotype in the
   * trace *name* rather than an `x` array. The generic reader pairs a category
   * with a value and skips a row that has only one, so it read these as empty -
   * silently, until `exportButtons` grew a guard against exactly that. The
   * subject ids ride in `text` and it would have dropped those too, and they are
   * the reason this figure is worth downloading at all.
   *
   * The stats that qualify the whole figure - effect, p, the smallest genotype
   * class - ride in the title, since they belong to the fit and not to a row.
   */
  /**
   * Outside links for the identifiers this variant has.
   *
   * One per rsID, because 7,107 mapped positions carry more than one and
   * picking would invent an identity; plus the GRCh38 coordinate, which reaches
   * a browser even where dbSNP has no name for the site.
   */
  get outsideLinks(): { label: string; url: string; title: string }[] {
    const d = this.dbsnp;
    if (!d?.mapped) {
      return [];
    }
    const links = d.rsids.map(rs => ({
      label: rs,
      url: `https://www.ncbi.nlm.nih.gov/snp/${rs}`,
      title: `${rs} at dbSNP`,
    }));
    if (d.grch38) {
      const at = `${d.grch38.contig}:${d.grch38.pos}`;
      links.push({
        label: at,
        url: 'https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position='
             + `${d.grch38.contig}%3A${d.grch38.pos}-${d.grch38.pos}`,
        title: `${at} on GRCh38, at the UCSC browser`,
      });
    }
    return links;
  }

  get usageTable(): ExportTable {
    return {
      columns: ['subject', 'genotype', 'usage'],
      rows: this.subjects
        .filter(s => s.genotype !== null && s.usage !== null)
        .map(s => [s.subject, GENOTYPE_LABEL[s.genotype as number] ?? '', s.usage as number]),
    };
  }

  readonly plotConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant?.variant}_${this.plottedAsc}_usage`,
      title: `Usage of ${this.plottedAsc} by ${this.variant?.variant} genotype`
        + (this.association
            ? `. Effect ${this.association.beta.toFixed(3)},`
              + ` p ${this.association.p_value.toExponential(2)},`
              + ` n ${this.association.n}`
              + (this.association.min_genotype_group !== null
                  ? `, smallest genotype class ${this.association.min_genotype_group}`
                    + (this.association.well_powered === false ? ' (not well powered)' : '')
                  : '')
            : ''),
      source: `/api/qtl/variant_usage/${this.selection?.species}/${this.selection?.locus}`
              + `/${this.variant?.variant}?asc=${this.plottedAsc}`,
      table: this.usageTable,
    })),
  };


  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection'] || changes['fallbackAsc']) {
      this.fetch();
    }
  }

  /** The ASC being plotted: the chosen one, else the one the point came from. */
  get plottedAsc(): string | undefined {
    return this.selection?.asc ?? this.fallbackAsc;
  }

  get counts(): { genotype: number; label: string; n: number }[] {
    return [0, 1, 2].map(genotype => ({
      genotype,
      label: GENOTYPE_LABEL[genotype],
      n: this.subjects.filter(s => s.genotype === genotype).length,
    })).filter(entry => entry.n > 0);
  }

  private fetch(): void {
    const { species, locus, variant } = this.selection ?? {};
    const asc = this.plottedAsc;

    if (!species || !locus || !variant) {
      this.variant = null;
      return;
    }

    this.isFetching = true;
    this.error = null;

    forkJoin({
      detail: this.qtl.variant(species, locus, variant),
      usage: asc
        ? this.qtl.variantUsage(species, locus, variant, asc)
            .pipe(catchError(() => of({ subjects: [], association: null })))
        : of({ subjects: [], association: null }),
    })
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? err?.message ?? 'Could not load this variant';
        this.isFetching = false;
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.variant = result.detail?.variant ?? null;
        this.dbsnp = result.detail?.dbsnp ?? null;
        this.associations = result.detail?.associations ?? [];
        this.hasGenotypes = !!result.detail?.has_genotypes;
        this.subjects = result.usage?.subjects ?? [];
        this.association = result.usage?.association ?? null;
        this.build();
      });
  }

  private build(): void {
    // one box per genotype class, points overlaid: with 29 subjects in a class a
    // box alone would imply more confidence than the data carries
    this.plotData = this.counts.map(({ genotype, label }) => {
      const rows = this.subjects.filter(s => s.genotype === genotype);
      return {
        type: 'box',
        name: `${label}  (n=${rows.length})`,
        y: rows.map(s => s.usage),
        text: rows.map(s => s.subject),
        boxpoints: 'all',
        jitter: 0.4,
        pointpos: 0,
        marker: { size: 6, opacity: 0.6, color: GENOTYPE_COLOUR[genotype] },
        line: { color: GENOTYPE_COLOUR[genotype] },
        fillcolor: 'rgba(0,0,0,0)',
        hovertemplate: '%{text}<br>usage %{y:.3%}<extra></extra>',
      };
    });

    this.plotLayout = {
      autosize: true,
      height: 440,
      margin: { l: 64, r: 20, t: 16, b: 44 },
      showlegend: false,
      xaxis: { title: { text: 'Genotype' }, automargin: true },
      yaxis: { title: { text: `Gene usage of ${this.plottedAsc ?? ''}` }, tickformat: '.1%',
               rangemode: 'tozero', automargin: true },
    };

  }
}
