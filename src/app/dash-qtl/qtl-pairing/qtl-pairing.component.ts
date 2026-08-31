import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlotlyModule } from 'angular-plotly.js';
import { EMPTY } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';

/**
 * What a variant does to the company a gene keeps.
 *
 * The usage scan asks how *much* a gene is used. This asks who it recombines
 * with: given a D, how the J it joins to is distributed, and the other way
 * round. The two are not restatements of each other - a variant can leave every
 * marginal usage untouched and still move the pairing.
 *
 * The printed version of this is one page of 144 panels, because paper cannot be
 * clicked. Here the anchor is chosen instead: one gene at a time, every partner
 * across it, which is the same data at a size a reader can actually read. The
 * anchor list carries each anchor's omnibus result, so which gene is worth
 * opening is visible before opening it.
 *
 * BOTH DIRECTIONS. `P(J|D)` anchors on a J and spreads the D genes across the
 * axis; `P(D|J)` does the reverse. They are separate scans over the same
 * variants and are never mixed, so switching re-asks the server rather than
 * transposing what is already here.
 */

const GENOTYPE_LABEL: Record<number, string> = { 0: '0/0', 1: '0/1', 2: '1/1' };
const GENOTYPE_COLOUR: Record<number, string> = { 0: '#2a78d6', 1: '#e34948', 2: '#eda100' };

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

  readonly conditionals = ['P(J|D)', 'P(D|J)'];
  conditional = 'P(J|D)';

  /** Only strict marks by default: the looser rule stars a third of the grid. */
  strictOnly = true;

  loadingVariants = false;
  loading = false;
  error: string | null = null;
  listError: string | null = null;

  variants: any[] = [];
  scanned = 0;
  /** False when this locus has no pairing scan at all, as against no hits. */
  hasScan = true;
  filter = '';
  variant: string | null = null;

  data: any = null;
  anchors: string[] = [];
  anchor: string | null = null;
  partners: string[] = [];
  omnibus: Record<string, Omnibus> = {};
  marks: Mark[] = [];
  genotypes: { genotype: number; n: number }[] = [];

  plotData: unknown[] = [];
  plotLayout: Record<string, unknown> = {};
  marginalData: unknown[] = [];
  marginalLayout: Record<string, unknown> = {};
  readonly plotConfig = { responsive: true, displaylogo: false };

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['species'] || changes['locus']) {
      this.variant = null;
      this.data = null;
      this.loadVariants();
    }
  }

  get anchorSide(): string {
    return this.conditional === 'P(J|D)' ? 'J' : 'D';
  }

  get partnerSide(): string {
    return this.conditional === 'P(J|D)' ? 'D' : 'J';
  }

  /** The list, narrowed by whatever was typed. */
  get shownVariants(): any[] {
    const q = this.filter.trim().toUpperCase();
    if (!q) {
      return this.variants.slice(0, 60);
    }
    return this.variants.filter(v =>
      v.variant.toUpperCase().includes(q)
      || (v.gene ?? '').toUpperCase().includes(q)).slice(0, 60);
  }

  onConditionalChange(): void {
    // a different conditional is a different scan, and its anchors are the other
    // side's genes, so nothing from the previous one carries over
    this.anchor = null;
    this.data = null;
    this.loadVariants();
    if (this.variant) {
      this.load();
    }
  }

  pickVariant(variant: string): void {
    this.variant = variant;
    this.anchor = null;
    this.load();
  }

  pickAnchor(anchor: string): void {
    this.anchor = anchor;
    this.draw();
  }

  toggleStrict(): void {
    this.strictOnly = !this.strictOnly;
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

  /** Marks for the open anchor, honouring the strict toggle. */
  get anchorMarks(): Mark[] {
    return this.marks.filter(m => m.anchor === this.anchor
                                  && (this.strictOnly ? m.marked_strict : m.marked));
  }

  private loadVariants(): void {
    if (!this.species || !this.locus) {
      this.variants = [];
      return;
    }
    this.loadingVariants = true;
    this.listError = null;

    this.qtl.pairingVariants(this.species, this.locus, this.conditional, 400)
      .pipe(catchError(err => {
        this.listError = err?.error?.message
          ?? `No partner-pairing scan is held for ${this.locus}`;
        this.loadingVariants = false;
        this.variants = [];
        return EMPTY;
      }))
      .subscribe(result => {
        this.loadingVariants = false;
        this.variants = result.variants ?? [];
        this.scanned = result.n_variants_scanned ?? 0;
        this.hasScan = !!result.scanned;
      });
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
        // open the anchor with the strongest omnibus, which is the one the scan
        // is actually about
        this.anchor = [...this.anchors].sort(
          (a, b) => (this.omnibus[b]?.neglog10_p ?? 0) - (this.omnibus[a]?.neglog10_p ?? 0)
        )[0] ?? null;
        this.draw();
      });
  }

  /**
   * One anchor, every partner, three genotype classes.
   *
   * Boxes come from the server already summarised. `lowerfence`/`upperfence` are
   * the data's own extremes rather than 1.5 IQR: these are proportions on a
   * bounded scale, and a subject outside the whiskers is a real subject, not
   * something to hide.
   */
  private draw(): void {
    if (!this.data || !this.anchor) {
      this.plotData = [];
      this.marginalData = [];
      return;
    }

    const cells: Cell[] = (this.data.cells ?? [])
      .filter((c: Cell) => c.anchor === this.anchor && c.box);
    const partners = this.partners;

    this.plotData = [0, 1, 2].map(gt => {
      const rows = partners.map(p =>
        cells.find(c => c.partner === p && c.genotype === gt)?.box ?? null);
      return {
        type: 'box',
        name: GENOTYPE_LABEL[gt],
        x: partners.map(p => this.short(p)),
        q1: rows.map(b => b?.q1 ?? null),
        median: rows.map(b => b?.median ?? null),
        q3: rows.map(b => b?.q3 ?? null),
        lowerfence: rows.map(b => b?.min ?? null),
        upperfence: rows.map(b => b?.max ?? null),
        marker: { color: GENOTYPE_COLOUR[gt] },
        line: { width: 1.2 },
        fillcolor: 'rgba(0,0,0,0)',
        hovertemplate: `%{x}  ${GENOTYPE_LABEL[gt]}<br>`
          + 'median %{median:.4f}<br>q1 %{q1:.4f} · q3 %{q3:.4f}<extra></extra>',
      };
    });

    // a star sits above the pair it belongs to, once, not once per genotype
    const starred = this.anchorMarks;
    if (starred.length) {
      const top = Math.max(...cells.map(c => c.box?.max ?? 0));
      this.plotData = [...this.plotData, {
        type: 'scatter', mode: 'text', showlegend: false,
        x: starred.map(m => this.short(m.partner)),
        y: starred.map(() => top * 1.04),
        text: starred.map(() => '✳'),
        textfont: { size: 13, color: '#188080' },
        hovertext: starred.map(m =>
          `${this.short(m.partner)} · p ${m.p_value?.toExponential(2) ?? '–'}`
          + `<br>n ${m.n_low ?? '?'} vs ${m.n_high ?? '?'}`),
        hovertemplate: '%{hovertext}<extra></extra>',
      }];
    }

    const anchorLabel = this.short(this.anchor);
    this.plotLayout = {
      height: 340,
      margin: { l: 60, r: 12, t: 28, b: 90 },
      boxmode: 'group',
      // Plotly 3 drops a plain string title silently and draws nothing
      xaxis: { title: { text: `${this.partnerSide} gene` }, tickangle: -60,
               automargin: true },
      yaxis: { title: { text: `${this.conditional} for ${anchorLabel}` },
               rangemode: 'tozero' },
      legend: { orientation: 'h', y: 1.12, x: 0 },
      showlegend: true,
    };

    // the anchor's own marginal, which is what the printed figure puts in its
    // left-hand column: does the variant move how much this gene is used at all,
    // as against who it pairs with
    const marg = (this.data.anchor_marginal ?? [])
      .filter((m: any) => m.gene === this.anchor && m.box);
    this.marginalData = [{
      type: 'box',
      x: marg.map((m: any) => GENOTYPE_LABEL[m.genotype]),
      q1: marg.map((m: any) => m.box.q1),
      median: marg.map((m: any) => m.box.median),
      q3: marg.map((m: any) => m.box.q3),
      lowerfence: marg.map((m: any) => m.box.min),
      upperfence: marg.map((m: any) => m.box.max),
      marker: { color: marg.map((m: any) => GENOTYPE_COLOUR[m.genotype]) },
      line: { width: 1.2 },
      fillcolor: 'rgba(0,0,0,0)',
      showlegend: false,
      hovertemplate: '%{x}<br>median %{median:.4f}<extra></extra>',
    }];
    this.marginalLayout = {
      height: 240,
      margin: { l: 62, r: 10, t: 24, b: 40 },
      xaxis: { title: { text: 'Genotype' } },
      yaxis: { title: { text: `P(${anchorLabel}) overall` }, rangemode: 'tozero' },
    };
  }
}
