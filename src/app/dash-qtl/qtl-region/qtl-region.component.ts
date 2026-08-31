import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { QtlService } from '../qtl.service';
import { QtlSelection, QtlThreshold, usageThreshold } from '../../shared/models/qtl-selection.model';

/**
 * The genomic neighbourhood a selected variant sits in.
 *
 * An association says a variant explains a gene's usage; it does not say what the
 * variant is. This is that: the gene bodies and functional elements around it in
 * their real coordinates, with every other tested variant in the window plotted
 * by significance, so a coding change and a hit 8 kb into intergenic sequence do
 * not look alike.
 *
 * Drawn as SVG in the template rather than with plotly, which is already loaded
 * elsewhere on this page. A genome track is a layout problem, not a charting one:
 * the marks are named rectangles at exact coordinates and every one of them has
 * to hover. Plotly draws rectangles as `shapes`, which do not hover at all, so it
 * would take invisible marker traces laid over the shapes to get the names back -
 * more code than the linear scale below, and a canvas that cannot take the
 * `--vdj-*` tokens the rest of the dashboard is drawn in. SVG `<title>` gives the
 * hover for free.
 */

const VIEW = 1000;          // viewBox width; the SVG scales to its container
const PAD = 6;

const PLOT_TOP = 16;
const PLOT_BOTTOM = 116;    // significance scatter occupies PLOT_TOP..PLOT_BOTTOM
const GENE_Y = 140;
const GENE_H = 9;
const ELEMENT_Y = 160;
const ELEMENT_H = 13;
const AXIS_Y = 190;
export const TRACK_HEIGHT = 214;

/** Feature classes, coloured so the leader's three parts read as one thing. */
const FEATURE_COLOUR: Record<string, string> = {
  coding: '#188080',
  leader: '#7cc0bd',
  rss: '#e08a1e',
  utr: '#b0bebd',
  constant: '#6a5acd',
  gene: '#c8d5d4',
};

const FEATURE_LABEL: Record<string, string> = {
  region: 'coding (V-REGION)',
  l_part1: 'leader, exon 1 (L-PART1)',
  leader_intron: 'leader intron',
  l_part2: 'leader, exon 2 (L-PART2)',
  heptamer: 'RSS heptamer',
  spacer: 'RSS spacer',
  nonamer: 'RSS nonamer',
  utr: "5' UTR",
  constant: 'constant region',
};

interface RegionFeature {
  name: string;
  start: number;
  end: number;
  feature: string;
  kind: string;
}

interface RegionVariant {
  variant: string;
  pos: number;
  maf: number | null;
  gene: string | null;
  feature: string | null;
  sub_feature: string | null;
  neglog10_p: number;
  significant: boolean;
  asc: string | null;
  selected: boolean;
}

/** A rectangle already in viewBox units, with the text its tooltip carries. */
interface Box {
  x: number;
  width: number;
  y: number;
  height: number;
  fill: string;
  label: string;
  title: string;
  /** Only wide boxes get their name written on them; the rest rely on hover. */
  showLabel: boolean;
  labelX: number;
}

interface Mark {
  cx: number;
  cy: number;
  r: number;
  variant: string;
  significant: boolean;
  selected: boolean;
  title: string;
}

@Component({
  selector: 'app-qtl-region',
  templateUrl: './qtl-region.component.html',
  styleUrls: ['./qtl-region.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class QtlRegionComponent implements OnChanges {
  @Input() selection: QtlSelection;
  /** The ASC the clicked point came from, when the scan was a whole-locus one. */
  @Input() fallbackAsc?: string;

  /** Clicking a neighbouring variant selects it, the way a Manhattan point does. */
  @Output() variantPicked = new EventEmitter<string>();

  readonly windows = [2000, 5000, 20000, 100000, 500000];
  window = 20000;

  isFetching = false;
  error: string | null = null;

  contig: string | null = null;
  start = 0;
  end = 0;
  centre = 0;
  annotated = true;
  annotationSource: string | null = null;
  variantCount = 0;
  genesInWindow: string[] = [];

  geneBoxes: Box[] = [];
  elementBoxes: Box[] = [];
  marks: Mark[] = [];
  ticks: { x: number; label: string }[] = [];
  thresholdY: number | null = null;
  yTicks: { y: number; label: string }[] = [];

  readonly view = VIEW;
  readonly height = TRACK_HEIGHT;
  readonly geneY = GENE_Y;
  readonly geneH = GENE_H;
  readonly elementY = ELEMENT_Y;
  readonly elementH = ELEMENT_H;
  readonly plotTop = PLOT_TOP;
  readonly plotBottom = PLOT_BOTTOM;
  readonly axisY = AXIS_Y;
  readonly pad = PAD;

  /** The legend, only for the classes actually on screen. */
  get legend(): { feature: string; colour: string }[] {
    const seen = new Set(this.elementBoxes.map(b => b.fill));
    return Object.entries(FEATURE_COLOUR)
      .filter(([feature, colour]) => feature !== 'gene' && seen.has(colour))
      .map(([feature, colour]) => ({ feature, colour }));
  }

  get plottedAsc(): string | undefined {
    return this.selection?.asc ?? this.fallbackAsc;
  }

  constructor(private qtl: QtlService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selection'] || changes['fallbackAsc']) {
      this.fetch();
    }
  }

  setWindow(value: string): void {
    this.window = Number(value);
    this.fetch();
  }

  private fetch(): void {
    const { species, locus, variant } = this.selection ?? {};
    if (!species || !locus || !variant) {
      this.clear();
      return;
    }

    this.isFetching = true;
    this.error = null;

    this.qtl.region(species, locus, variant, this.window, this.plottedAsc)
      .pipe(catchError(err => {
        this.error = err?.error?.message ?? err?.message ?? 'Could not load this region';
        this.isFetching = false;
        this.clear();
        return EMPTY;
      }))
      .subscribe(result => {
        this.isFetching = false;
        this.build(result);
      });
  }

  private clear(): void {
    this.geneBoxes = [];
    this.elementBoxes = [];
    this.marks = [];
    this.ticks = [];
    this.genesInWindow = [];
    this.variantCount = 0;
  }

  private x(pos: number): number {
    const span = Math.max(1, this.end - this.start);
    return PAD + ((pos - this.start) / span) * (VIEW - 2 * PAD);
  }

  private build(result: any): void {
    this.contig = result.contig;
    this.start = result.window.start;
    this.end = result.window.end;
    this.centre = result.window.centre;
    this.annotated = !!result.annotation?.available;
    this.annotationSource = result.annotation?.source ?? null;

    const features: RegionFeature[] = result.features ?? [];
    const genes: RegionFeature[] = result.genes ?? [];
    const variants: RegionVariant[] = result.variants ?? [];

    this.variantCount = variants.length;
    this.genesInWindow = genes.map(g => g.name);

    this.geneBoxes = genes.map(g => this.box(g, GENE_Y, GENE_H,
      FEATURE_COLOUR['gene'], g.name,
      `${g.name}\n${fmt(g.start)}–${fmt(g.end)}  (${fmt(g.end - g.start + 1)} bp)`));
    labelWithoutColliding(this.geneBoxes);

    this.elementBoxes = features.map(f => this.box(f, ELEMENT_Y, ELEMENT_H,
      FEATURE_COLOUR[f.feature] ?? FEATURE_COLOUR['utr'],
      FEATURE_LABEL[f.kind] ?? f.kind,
      `${f.name} · ${FEATURE_LABEL[f.kind] ?? f.kind}\n` +
      `${fmt(f.start)}–${fmt(f.end)}  (${fmt(f.end - f.start + 1)} bp)`));

    // the y scale is the same one the Manhattan uses, and it has to include the
    // threshold even when nothing in this window comes near it, or the line
    // falls off the top and the window looks uniformly significant
    const threshold = usageThreshold((result.thresholds ?? []) as QtlThreshold[]);
    const line = threshold?.neglog10_threshold ?? null;
    const top = Math.max(1, ...variants.map(v => v.neglog10_p), line ?? 0) * 1.08;

    const y = (value: number) =>
      PLOT_BOTTOM - (Math.max(0, value) / top) * (PLOT_BOTTOM - PLOT_TOP);

    this.thresholdY = line === null ? null : y(line);
    this.yTicks = [0, top / 2, top].map(value => ({ y: y(value), label: value.toFixed(0) }));

    this.marks = variants.map(v => ({
      cx: this.x(v.pos),
      cy: y(v.neglog10_p),
      r: v.selected ? 5.5 : 3,
      variant: v.variant,
      significant: v.significant,
      selected: v.selected,
      title: `${v.variant}\n${describe(v)}\n` +
             `-log10 p ${v.neglog10_p.toFixed(2)}${v.asc ? `  (${v.asc})` : ''}` +
             `${v.maf === null ? '' : `\nMAF ${(v.maf * 100).toFixed(1)}%`}`,
    }));

    const step = (this.end - this.start) / 4;
    this.ticks = [0, 1, 2, 3, 4].map(i => {
      const pos = Math.round(this.start + i * step);
      return { x: this.x(pos), label: kb(pos) };
    });
  }

  private box(f: RegionFeature, y: number, height: number,
              fill: string, label: string, title: string): Box {
    // clipped to the window: a gene can start before it and end after it.
    // `end` is inclusive, so the box runs to the far side of that base - drawing
    // to x(end) instead stops one base short and leaves a visible gap at every
    // join between two elements that are in fact contiguous.
    const left = this.x(Math.max(f.start, this.start));
    const right = this.x(Math.min(f.end, this.end) + 1);
    const width = Math.max(0.8, right - left);   // a 7 bp heptamer is sub-pixel
    return {
      x: left, width, y, height, fill, label, title,
      // an element label is written inside its own block, so it has to fit
      showLabel: width > label.length * 4.4,
      labelX: left + width / 2,
    };
  }

  get selectedX(): number {
    return this.x(this.centre);
  }

  pick(variant: string): void {
    if (variant !== this.selection?.variant) {
      this.variantPicked.emit(variant);
    }
  }
}

/**
 * Show a gene's name unless it would sit on the previous one's.
 *
 * Gene labels are written *above* the bar, not inside it, so the block's own
 * width is the wrong test: a 500 bp V gene is 25 px wide in a 20 kb window and
 * `IGKV1-17` needs 35, which would suppress the name at the default zoom - the
 * one place it is most wanted. What actually has to fit is the label against its
 * neighbour, so that is what is checked, left to right.
 */
function labelWithoutColliding(boxes: Box[]): void {
  let rightmost = -Infinity;
  for (const box of [...boxes].sort((a, b) => a.labelX - b.labelX)) {
    const half = box.label.length * 2.2;
    box.showLabel = box.labelX - half > rightmost + 2;
    if (box.showLabel) {
      rightmost = box.labelX + half;
    }
  }
}

function describe(v: RegionVariant): string {
  if (!v.gene) {
    return 'no annotated gene';
  }
  const kind = FEATURE_LABEL[v.sub_feature ?? ''] ?? v.feature ?? '';
  return `${kind} · ${v.gene}`;
}

function fmt(value: number): string {
  return value.toLocaleString('en-US');
}

function kb(pos: number): string {
  return `${(pos / 1000).toFixed(pos > 1e6 ? 0 : 1)} kb`;
}

