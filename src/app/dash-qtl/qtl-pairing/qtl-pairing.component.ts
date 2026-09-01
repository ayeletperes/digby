import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { ExportTable, exportButtons } from '../../shared/plot-export/plot-export';

/**
 * What a variant does to the company a gene keeps.
 *
 * The usage scan asks how *much* a gene is used. This asks who it recombines
 * with: given a D, how the J it joins to is distributed, and the other way
 * round. The two are not restatements of each other - a variant can leave every
 * marginal usage untouched and still move the pairing.
 *
 * LAID OUT AS THE FIGURE IS, because the figure's layout is an argument. The
 * conditional grid in the middle only means something against three things
 * beside it: the subject counts, so a class of five is not read as a
 * distribution; the anchor's own marginal down the left, so a moved pairing can
 * be told apart from moved usage; and the partner marginal along the bottom, so
 * a column that is low everywhere is not mistaken for an effect. Printed, all
 * six anchors are stacked at once. Here one to three are chosen, which is the
 * same figure at a size that can be read.
 *
 * BOTH DIRECTIONS. `P(J|D)` anchors on a J and spreads the D genes across the
 * axis; `P(D|J)` does the reverse. They are separate scans over the same
 * variants and are never mixed, so switching re-asks the server rather than
 * transposing what is already here.
 */

const GENOTYPE_LABEL: Record<number, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };
const GENOTYPE_COLOUR: Record<number, string> = { 0: '#2a78d6', 1: '#e34948', 2: '#eda100' };

/** More than three rows and each is too short to read a box off. */
const MAX_ANCHORS = 3;

/** Shared by every right-hand plot so their columns line up down the page. */
const GRID_MARGIN = { l: 58, r: 10, t: 8, b: 4 };
const ROW_HEIGHT = 190;

interface Box {
  n: number; min: number; q1: number; median: number; q3: number; max: number; mean: number;
}
interface Cell { anchor: string; partner: string; genotype: number; box: Box | null; }
interface Mark {
  anchor: string; partner: string; marked: boolean; marked_strict: boolean;
  p_value: number | null; delta_mean: number | null; n_low: number | null; n_high: number | null;
  omnibus_significant: boolean;
}
interface Omnibus {
  n: number; pillai: number; f_stat: number; p_value: number; neglog10_p: number;
  min_genotype_group: number | null; significant: boolean;
}

/** One anchor's row of the figure: its marginal, and its partner grid. */
interface AnchorRow {
  anchor: string;
  label: string;
  omnibus: Omnibus | null;
  marks: Mark[];
  gridData: unknown[];
  gridLayout: Record<string, unknown>;
  marginalData: unknown[];
  marginalLayout: Record<string, unknown>;
}

@Component({
  selector: 'app-qtl-pairing',
  templateUrl: './qtl-pairing.component.html',
  styleUrls: ['./qtl-pairing.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, PlotlyModule],
})
export class QtlPairingComponent implements OnChanges {
  @Input() species?: string;
  @Input() locus?: string;
  /**
   * Which variant, and which direction, both chosen in the rail.
   *
   * They used to live here, in a card beside the figure, which made this the one
   * analysis whose subject was picked somewhere different from all the others.
   * The shell owns them now, as it owns the gene for one tab and the variant for
   * another, and this draws whatever it is handed.
   */
  @Input() variant: string | null = null;
  @Input() conditional = 'P(J|D)';
  readonly maxAnchors = MAX_ANCHORS;

  /** Only strict marks by default: the looser rule stars a third of the grid. */
  strictOnly = true;

  /**
   * Which surrounding panels are drawn.
   *
   * Both are on by default because each answers a question the grid raises, but
   * a reader who has already asked them is entitled to the space back: with
   * three anchors and 24 partners the grid is the part that wants the pixels.
   */
  showAnchorMarginal = true;
  showPartnerMarginal = true;

  /** How to read the surrounding panels, behind the site's info control. */
  infoOpen = false;

  /** The genotype key, drawn in HTML so it can sit outside any one figure. */
  readonly genotypeKey = [0, 1, 2].map(g => ({
    label: GENOTYPE_LABEL[g], colour: GENOTYPE_COLOUR[g],
  }));

  loading = false;
  error: string | null = null;


  data: any = null;
  anchors: string[] = [];
  /** One to three, drawn as stacked rows the way the figure stacks all of them. */
  chosen: string[] = [];
  partners: string[] = [];
  omnibus: Record<string, Omnibus> = {};
  marks: Mark[] = [];
  genotypes: { genotype: number; n: number }[] = [];

  rows: AnchorRow[] = [];
  countsData: unknown[] = [];
  countsLayout: Record<string, unknown> = {};
  partnerData: unknown[] = [];
  partnerLayout: Record<string, unknown> = {};
  readonly plotConfig = { responsive: true, displaylogo: false };

  /**
   * Every figure here exports its own table, because none of them holds its own
   * data: the boxes arrive from the server already summarised, carried in
   * `q1`/`median`/`q3` with no `y` at all, so the generic trace reader would
   * hand over empty values.
   *
   * The summaries travel with what qualifies them - the group's `n`, the
   * omnibus p, and the pipeline's own mark - because a downloaded quartile with
   * no count behind it cannot be told apart from one resting on five subjects.
   */
  private boxRow(b: Box | null | undefined): (string | number)[] {
    return b ? [b.n, b.min, b.q1, b.median, b.q3, b.max, b.mean] : ['', '', '', '', '', '', ''];
  }

  private readonly BOX_COLUMNS = ['n', 'min', 'q1', 'median', 'q3', 'max', 'mean'];

  gridConfig(anchor: string): Record<string, unknown> {
    return {
      responsive: true, displaylogo: false,
      modeBarButtonsToAdd: exportButtons(() => ({
        name: `${this.variant}_${this.short(anchor)}_${this.conditional.replace(/[|()]/g, '')}`,
        title: `${this.conditional} for ${this.short(anchor)} by ${this.variant} genotype`,
        source: `/api/qtl/pairing/${this.species}/${this.locus}/${this.variant}`
                + `?conditional=${encodeURIComponent(this.conditional)}`,
        table: this.anchorTable(anchor),
      })),
    };
  }

  /** One row per (partner, genotype), with the mark and omnibus that qualify it. */
  anchorTable(anchor: string): ExportTable {
    const o = this.omnibus[anchor];
    const marks = new Map(this.marks.filter(m => m.anchor === anchor)
                                    .map(m => [m.partner, m]));
    const rows: (string | number)[][] = [];
    for (const partner of this.partners) {
      for (const g of [0, 1, 2]) {
        const cell = (this.data?.cells ?? []).find(
          (c: Cell) => c.anchor === anchor && c.partner === partner && c.genotype === g);
        const mk = marks.get(partner);
        rows.push([this.short(anchor), this.short(partner), GENOTYPE_LABEL[g],
                   ...this.boxRow(cell?.box),
                   mk?.marked ? 'yes' : 'no', mk?.marked_strict ? 'yes' : 'no',
                   mk?.p_value ?? '', o?.p_value ?? '', o?.significant ? 'yes' : 'no',
                   o?.min_genotype_group ?? '']);
      }
    }
    return {
      columns: [this.anchorSide, this.partnerSide, 'genotype', ...this.BOX_COLUMNS,
                'cell_marked', 'cell_marked_strict', 'cell_p_value',
                'omnibus_p_value', 'omnibus_significant', 'smallest_genotype_class'],
      rows,
    };
  }

  marginalConfig(anchor: string): Record<string, unknown> {
    return {
      responsive: true, displaylogo: false,
      modeBarButtonsToAdd: exportButtons(() => ({
        name: `${this.variant}_${this.short(anchor)}_marginal`,
        title: `Overall use of ${this.short(anchor)} by ${this.variant} genotype`,
        source: `/api/qtl/pairing/${this.species}/${this.locus}/${this.variant}`
                + `?conditional=${encodeURIComponent(this.conditional)}`,
        table: {
          columns: ['gene', 'genotype', ...this.BOX_COLUMNS],
          rows: (this.data?.anchor_marginal ?? [])
            .filter((m: any) => m.gene === anchor)
            .map((m: any) => [this.short(m.gene), GENOTYPE_LABEL[m.genotype],
                              ...this.boxRow(m.box)]),
        },
      })),
    };
  }

  readonly partnerConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant}_${this.partnerSide}_marginal`,
      title: `Overall use of each ${this.partnerSide} gene by ${this.variant} genotype`,
      source: `/api/qtl/pairing/${this.species}/${this.locus}/${this.variant}`
              + `?conditional=${encodeURIComponent(this.conditional)}`,
      table: {
        columns: ['gene', 'genotype', ...this.BOX_COLUMNS],
        rows: (this.data?.partner_marginal ?? [])
          .map((m: any) => [this.short(m.gene), GENOTYPE_LABEL[m.genotype],
                            ...this.boxRow(m.box)]),
      },
    })),
  };

  readonly countsConfig = {
    responsive: true, displaylogo: false,
    modeBarButtonsToAdd: exportButtons(() => ({
      name: `${this.variant}_genotype_counts`,
      title: `Subjects carrying each ${this.variant} genotype`,
      source: `/api/qtl/pairing/${this.species}/${this.locus}/${this.variant}`
              + `?conditional=${encodeURIComponent(this.conditional)}`,
      table: {
        columns: ['genotype', 'subjects'],
        rows: this.genotypes.map(g => [GENOTYPE_LABEL[g.genotype], g.n]),
      },
    })),
  };
  readonly rowHeight = ROW_HEIGHT;

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['conditional']) {
      // a different conditional is a different scan, and its anchors are the
      // other side's genes, so nothing from the previous one carries over
      this.chosen = [];
    }
    if (changes['species'] || changes['locus'] || changes['variant']
        || changes['conditional']) {
      this.data = null;
      this.rows = [];
      if (this.variant) {
        this.load();
      }
    }
  }

  get anchorSide(): string {
    return this.conditional === 'P(J|D)' ? 'J' : 'D';
  }

  get partnerSide(): string {
    return this.conditional === 'P(J|D)' ? 'D' : 'J';
  }




  /** Anchors are a small multi-select: click to add, click again to drop. */
  toggleAnchor(anchor: string): void {
    if (this.chosen.includes(anchor)) {
      this.chosen = this.chosen.filter(a => a !== anchor);
    } else if (this.chosen.length < MAX_ANCHORS) {
      // kept in the scan's own order, so adding a row does not reshuffle the rest
      this.chosen = this.anchors.filter(a => a === anchor || this.chosen.includes(a));
    }
    this.draw();
  }

  isChosen(anchor: string): boolean {
    return this.chosen.includes(anchor);
  }

  get atAnchorLimit(): boolean {
    return this.chosen.length >= MAX_ANCHORS;
  }

  toggleStrict(): void {
    this.strictOnly = !this.strictOnly;
    this.draw();
  }

  toggleInfo(): void {
    this.infoOpen = !this.infoOpen;
  }

  toggleAnchorMarginal(): void {
    this.showAnchorMarginal = !this.showAnchorMarginal;
    this.draw();
  }

  togglePartnerMarginal(): void {
    this.showPartnerMarginal = !this.showPartnerMarginal;
    this.draw();
  }

  /**
   * Short display form: IGH's D clusters carry the locus, J genes do not.
   *
   * Stripped from every member, not just the first: a merged cluster is stored
   * `IGHD2-2/IGHD2-8`, and taking the prefix off the front alone left the label
   * `D2-2/IGHD2-8`, which reads as two different kinds of name. Display only -
   * the stored string is the join key and is never rewritten.
   */
  short(gene: string): string {
    const locus = this.locus;
    if (!locus) {
      return gene;
    }
    return gene.split('/')
      .map(part => part.toUpperCase().startsWith(locus.toUpperCase())
                     ? part.slice(locus.length) : part)
      .join('/');
  }

  omnibusOf(anchor: string): Omnibus | null {
    return this.omnibus[anchor] ?? null;
  }

  get anchorsWithSignal(): number {
    return this.anchors.filter(a => this.omnibus[a]?.significant).length;
  }

  /** Every anchor's omnibus, strongest first - the test that ranked this variant. */
  get omnibusRows(): { anchor: string; label: string; o: Omnibus }[] {
    return this.anchors
      .map(a => ({ anchor: a, label: this.short(a), o: this.omnibus[a] }))
      .filter(r => !!r.o)
      .sort((x, y) => y.o.neglog10_p - x.o.neglog10_p);
  }


  private load(): void {
    if (!this.species || !this.locus || !this.variant) {
      return;
    }
    this.loading = true;
    this.error = null;

    this.qtl.pairing(this.species, this.locus, this.variant, this.conditional)
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? 'Could not load this pairing scan';
        this.loading = false;
        this.data = null;
        return EMPTY;
      }))
      .subscribe(result => {
        this.loading = false;
        this.data = result;
        this.anchors = result.anchors ?? [];
        this.partners = result.partners ?? [];
        this.omnibus = result.omnibus ?? {};
        this.marks = result.marks ?? [];
        this.genotypes = result.genotypes ?? [];
        // open the strongest anchor, which is the one the scan is about
        const best = [...this.anchors].sort(
          (a, b) => (this.omnibus[b]?.neglog10_p ?? 0) - (this.omnibus[a]?.neglog10_p ?? 0));
        this.chosen = best.slice(0, 1);
        this.draw();
      });
  }

  private marksFor(anchor: string): Mark[] {
    return this.marks.filter(m => m.anchor === anchor
                                  && (this.strictOnly ? m.marked_strict : m.marked));
  }

  /**
   * Every panel of the figure, sharing one category order.
   *
   * The right-hand plots all take the same partner categories and the same left
   * margin, so their columns line up down the page - which is the only reason
   * stacking rows says anything: a cell is read against the cell above it and
   * against the partner marginal at the bottom.
   */
  private draw(): void {
    if (!this.data) {
      this.rows = [];
      this.countsData = [];
      this.partnerData = [];
      return;
    }

    const partnerLabels = this.partners.map(p => this.short(p));
    const allCells: Cell[] = this.data.cells ?? [];

    // ---- subject counts. The figure puts these beside the grid for a reason:
    // a genotype class of five subjects is not a distribution, whatever the box
    // looks like.
    this.countsData = [{
      type: 'bar',
      x: this.genotypes.map(g => GENOTYPE_LABEL[g.genotype]),
      y: this.genotypes.map(g => g.n),
      text: this.genotypes.map(g => String(g.n)),
      textposition: 'outside',
      cliponaxis: false,
      marker: { color: this.genotypes.map(g => GENOTYPE_COLOUR[g.genotype]) },
      hovertemplate: '%{x}: %{y} subjects<extra></extra>',
    }];
    this.countsLayout = {
      height: ROW_HEIGHT,
      margin: { l: 46, r: 10, t: 8, b: 34 },
      showlegend: false,
      // Plotly 3 drops a plain string title silently and draws nothing
      xaxis: { title: { text: 'Genotype' } },
      yaxis: { title: { text: '# subjects' }, rangemode: 'tozero' },
    };

    // ---- one row per chosen anchor
    this.rows = this.chosen.map(anchor => {
      const cells = allCells.filter(c => c.anchor === anchor && c.box);
      const label = this.short(anchor);

      const gridData: unknown[] = [0, 1, 2].map(gt => {
        const boxes = this.partners.map(p =>
          cells.find(c => c.partner === p && c.genotype === gt)?.box ?? null);
        return {
          type: 'box',
          name: GENOTYPE_LABEL[gt],
          x: partnerLabels,
          q1: boxes.map(b => b?.q1 ?? null),
          median: boxes.map(b => b?.median ?? null),
          q3: boxes.map(b => b?.q3 ?? null),
          lowerfence: boxes.map(b => b?.min ?? null),
          upperfence: boxes.map(b => b?.max ?? null),
          marker: { color: GENOTYPE_COLOUR[gt] },
          line: { width: 1.1 },
          fillcolor: 'rgba(0,0,0,0)',
          showlegend: false,
          hovertemplate: `%{x}  ${GENOTYPE_LABEL[gt]}<br>`
            + 'median %{median:.4f}<br>q1 %{q1:.4f} · q3 %{q3:.4f}<extra></extra>',
        };
      });

      // a star sits above the pair it belongs to, once, not once per genotype
      const starred = this.marksFor(anchor);
      const top = Math.max(0.0001, ...cells.map(c => c.box?.max ?? 0));
      if (starred.length) {
        gridData.push({
          type: 'scatter', mode: 'text', showlegend: false,
          x: starred.map(m => this.short(m.partner)),
          y: starred.map(() => top * 1.03),
          text: starred.map(() => '✳'),
          textfont: { size: 12, color: '#188080' },
          hovertext: starred.map(m =>
            `${this.short(m.partner)} · p ${m.p_value?.toExponential(2) ?? '–'}`
            + `<br>n ${m.n_low ?? '?'} vs ${m.n_high ?? '?'}`),
          hovertemplate: '%{hovertext}<extra></extra>',
        });
      }

      // The partner names appear once, on whichever figure is bottom-most:
      // normally the partner marginal, and the last grid when that is hidden.
      // Repeating them on every row is noise; omitting them everywhere leaves
      // the columns unlabelled.
      const isLast = anchor === this.chosen[this.chosen.length - 1];
      const carriesAxis = isLast && !this.showPartnerMarginal;
      const gridLayout: Record<string, unknown> = {
        height: ROW_HEIGHT + (carriesAxis ? 70 : 0),
        margin: { ...GRID_MARGIN, b: carriesAxis ? 78 : 4 },
        boxmode: 'group',
        showlegend: false,
        xaxis: { type: 'category', categoryorder: 'array', categoryarray: partnerLabels,
                 showticklabels: carriesAxis, ticks: '',
                 ...(carriesAxis ? { title: { text: `${this.partnerSide} gene` },
                                     tickangle: -60 } : {}) },
        yaxis: { title: { text: `${this.conditional} · ${label}` },
                 rangemode: 'tozero', automargin: false },
      };

      const marg = (this.data.anchor_marginal ?? [])
        .filter((m: any) => m.gene === anchor && m.box);
      const marginalData: unknown[] = [{
        type: 'box',
        x: marg.map((m: any) => GENOTYPE_LABEL[m.genotype]),
        q1: marg.map((m: any) => m.box.q1),
        median: marg.map((m: any) => m.box.median),
        q3: marg.map((m: any) => m.box.q3),
        lowerfence: marg.map((m: any) => m.box.min),
        upperfence: marg.map((m: any) => m.box.max),
        marker: { color: marg.map((m: any) => GENOTYPE_COLOUR[m.genotype]) },
        line: { width: 1.1 },
        fillcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        hovertemplate: '%{x}<br>median %{median:.4f}<extra></extra>',
      }];
      const marginalLayout: Record<string, unknown> = {
        height: ROW_HEIGHT,
        margin: { l: 46, r: 10, t: 8, b: 4 },
        xaxis: { type: 'category', showticklabels: false, ticks: '' },
        yaxis: { title: { text: `P(${label})` }, rangemode: 'tozero' },
      };

      return { anchor, label, omnibus: this.omnibus[anchor] ?? null,
               marks: starred, gridData, gridLayout, marginalData, marginalLayout };
    });

    // ---- the partner marginal along the bottom, on the same categories. A
    // column that is low under every genotype is low because that partner is
    // rare, not because the variant did anything to it.
    const pm = this.data.partner_marginal ?? [];
    this.partnerData = [0, 1, 2].map(gt => {
      const boxes = this.partners.map(p =>
        pm.find((m: any) => m.gene === p && m.genotype === gt)?.box ?? null);
      return {
        type: 'box',
        name: GENOTYPE_LABEL[gt],
        x: partnerLabels,
        q1: boxes.map((b: any) => b?.q1 ?? null),
        median: boxes.map((b: any) => b?.median ?? null),
        q3: boxes.map((b: any) => b?.q3 ?? null),
        lowerfence: boxes.map((b: any) => b?.min ?? null),
        upperfence: boxes.map((b: any) => b?.max ?? null),
        marker: { color: GENOTYPE_COLOUR[gt] },
        line: { width: 1.1 },
        fillcolor: 'rgba(0,0,0,0)',
        hovertemplate: `%{x}  ${GENOTYPE_LABEL[gt]}<br>`
          + 'median %{median:.4f}<extra></extra>',
      };
    });
    this.partnerLayout = {
      height: ROW_HEIGHT + 70,
      margin: { ...GRID_MARGIN, b: 78 },
      boxmode: 'group',
      xaxis: { type: 'category', categoryorder: 'array', categoryarray: partnerLabels,
               title: { text: `${this.partnerSide} gene` }, tickangle: -60 },
      yaxis: { title: { text: `P(${this.partnerSide}) overall` }, rangemode: 'tozero' },
      showlegend: false,
    };
  }
}
