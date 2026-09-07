import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import * as UpSetJS from '@upsetjs/bundle';

import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { shortenAlleleNames } from '../../shared/models/gene-naming';
import { SpeciesGeneSelection, projectsParam, samplesParam, allelesParam, sourcesParam }
  from '../../shared/models/species-gene-selection.model';
import { DashDrillService } from '../dash-drill.service';
import { ScopeNoteComponent } from '../scope-note/scope-note.component';
import { PlotExportComponent } from '../../shared/plot-export/plot-export.component';
import { ExportTable } from '../../shared/plot-export/plot-export';

/** Rough width of one character of the set label at its font size. */
const LABEL_CHAR_PX = 6.2;
/** Most of the chart the labels may take before it is widened instead. */
const MAX_LABEL_SHARE = 0.34;
/** Share given to the per-set bar chart, left of the labels. */
const SET_CHART_SHARE = 0.18;
/** Row height per allele. Below about 20 the 10px labels start to touch. */
const ROW_PX = 24;

/** How many alleles to draw, most carried first. */
const TOP_CHOICES: { label: string; value: number | null }[] = [
  { label: 'Top 5', value: 5 },
  { label: 'Top 10', value: 10 },
  { label: 'Top 20', value: 20 },
  { label: 'All', value: null },
];

class ZygosityData {
  samples: {
    name: string;
    sets: string[];
  }[];
}

@Component({
  selector: 'app-dash-refbook-zygosity',
  templateUrl: './dash-refbook-zygosity.component.html',
  styles: [`
    .upset-toolbar {
      display: flex; align-items: center; gap: 0.5rem;
      margin: 0 0 0.5rem; font-size: 0.8rem; color: var(--vdj-body, #455857);
    }
    .upset-toolbar label { font-weight: 600; }
    .upset-toolbar select { width: auto; min-width: 6rem; }
    .upset-note { color: var(--vdj-muted, #7a8c8b); }

    /* Width comes from the column; height is set per render from the number of sets. */
    .upset-chart { width: 100%; min-width: 0; overflow-x: auto; }

    .upset-status { margin: 0.5rem 0; font-size: 0.85rem; color: #5f6368; }
    .upset-status.error { color: #d62839; }
  `],
  standalone: true,
  imports: [CommonModule, FormsModule, ScopeNoteComponent, PlotExportComponent],
})
export class DashRefbookZygosityComponent
  implements OnInit, OnChanges, AfterViewInit, OnDestroy {

  @Input() selection: SpeciesGeneSelection;

  isFetching = false;
  error = '';
  zygosityData: ZygosityData = { samples: [] };

  private selectionState: unknown = null;
  private resizeObs?: ResizeObserver;
  private renderHandle?: ReturnType<typeof setTimeout>;
  /** The drawn combinations, in full allele names, for the downloads. */
  private drawnCombinations: { alleles: string[]; count: number }[] = [];

  readonly topChoices = TOP_CHOICES;
  /** Alleles drawn, most carried first. Null means every one. */
  topN: number | null = 10;
  /** How many the gene has, so the control can say what is being hidden. */
  alleleCount = 0;

  onTopChange(value: number | null): void {
    this.topN = value;
    this.scheduleRender();
  }

  constructor(private refbookService: RefbookService, private host: ElementRef<HTMLElement>,
              private drill: DashDrillService) {}

  /** The chart container. */
  private get container(): HTMLDivElement | null {
    return this.host.nativeElement.querySelector('.upset-chart');
  }

  ngOnInit() {
    this.fetchZygosityData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && !changes['selection'].firstChange) {
      this.fetchZygosityData();
    }
  }

  ngAfterViewInit() {
    const el = this.container;
    if (el && 'ResizeObserver' in window) {
      // UpSet is redrawn imperatively, so resizing during layout can paint the
      this.resizeObs = new ResizeObserver(() => this.scheduleRender());
      this.resizeObs.observe(el);
    }
    this.scheduleRender();
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    clearTimeout(this.renderHandle);
  }

  fetchZygosityData() {
    if (!this.selection?.species || !this.selection?.chain || !this.selection?.asc) {
      return;
    }

    this.isFetching = true;
    this.error = '';
    this.zygosityData = { samples: [] };
    this.selectionState = null;

    this.refbookService
      .getAscZygosity(this.selection.species, this.selection.chain, this.selection.asc,
                     projectsParam(this.selection), samplesParam(this.selection),
                     allelesParam(this.selection), sourcesParam(this.selection))
      .pipe(
        retryWithBackoff(),
        catchError(() => {
          this.error = 'Failed to load zygosity data.';
          this.isFetching = false;
          return EMPTY;
        }),
      )
      .subscribe((data: ZygosityData) => {
        this.zygosityData = data;
        this.isFetching = false;
        this.selectionState = null;
        this.scheduleRender();
      });
  }

  private scheduleRender() {
    // Coalesced with a timer rather than requestAnimationFrame: rAF does not fire
    clearTimeout(this.renderHandle);
    this.renderHandle = setTimeout(() => this.renderUpset(), 0);
  }

  private renderUpset() {
    const el = this.container;
    if (!el || !this.zygosityData?.samples?.length) {
      return;
    }

    const width = el.clientWidth;
    if (!width) {
      return;     // laid out in a hidden tab; the observer fires again when shown
    }

    try {
      this.drawUpset(el, width);
    } catch (e) {
      // a render that throws inside the scheduled callback leaves an empty box and
      this.error = `Could not draw the plot: ${(e as Error)?.message ?? e}`;
      el.innerHTML = '';
    }
  }

  /** Shortened set label back to the allele it stands for, for the drill. */
  private fullNameOf = new Map<string, string>();

  /** The figure's numbers: which alleles a subject carries, and how many subjects carry exactly that set. */
  get exportTable(): ExportTable {
    const combos = this.drawnCombinations ?? [];
    return {
      columns: ['alleles', 'n_alleles', 'samples'],
      rows: combos.map(c => [c.alleles.join(';'), c.alleles.length, c.count]),
    };
  }

  get exportScript(): string {
    const combos = this.drawnCombinations ?? [];
    if (!combos.length) {
      return '';
    }
    const quote = (t: string) => "'" + t.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    const memberships = combos
      .map(c => '    [' + c.alleles.map(quote).join(', ') + '],').join('\n');
    const counts = combos.map(c => c.count).join(', ');

    return `# ${this.selection?.asc} - alleles carried together
#
# Generated by VDJbase. One entry per combination: the alleles a subject carries,
# and how many subjects carry exactly that set. Names are full, not the shortened
# forms the chart draws.
#
# To pull the data again instead:
#   /api/refbook/asc_zygosity/${this.selection?.species}/${this.selection?.chain}/${this.selection?.asc}
#
# pip install upsetplot matplotlib

import matplotlib.pyplot as plt
from upsetplot import from_memberships, plot

MEMBERSHIPS = [
${memberships}
]

COUNTS = [${counts}]

data = from_memberships(MEMBERSHIPS, data=COUNTS)
plot(data, sort_by='cardinality', show_counts=True)
plt.suptitle(${quote(String(this.selection?.asc ?? ''))} + ' - alleles carried together')
plt.savefig('figure.png', dpi=300, bbox_inches='tight')
plt.show()
`;
  }

  /** The samples, with each one's alleles cut to the most carried. */
  private topSamples(): { name: string; sets: string[] }[] {
    const samples = this.zygosityData.samples ?? [];
    const carriers = new Map<string, number>();
    for (const sample of samples) {
      for (const allele of sample.sets) {
        carriers.set(allele, (carriers.get(allele) ?? 0) + 1);
      }
    }
    this.alleleCount = carriers.size;

    if (!this.topN || this.topN >= carriers.size) {
      return samples;
    }

    const keep = new Set([...carriers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, this.topN)
      .map(([allele]) => allele));

    return samples
      .map(sample => ({ ...sample, sets: sample.sets.filter(a => keep.has(a)) }))
      .filter(sample => sample.sets.length);
  }

  private drawUpset(el: HTMLDivElement, width: number) {
    const { sets, combinations } = UpSetJS.extractCombinations(this.topSamples());

    // Shorten the labels, but only after extraction: the set name is the set's
    const display = shortenAlleleNames(sets.map(set => set.name ?? ''));
    this.fullNameOf = new Map();
    for (const set of sets) {
      const full = set.name ?? '';
      const short = display.get(full) ?? full;
      this.fullNameOf.set(short, full);
      (set as { name: string }).name = short;
    }

    // The set list is drawn down the left, so height follows it. There is no upper
    const height = Math.max(280, 180 + sets.length * ROW_PX);

    // Allele names are long (IGHV1-2*02_c135t and worse), and the default label
    const longest = sets.reduce((n, set) => Math.max(n, (set.name ?? '').length), 0);
    const labelPx = Math.min(320, Math.max(90, longest * LABEL_CHAR_PX));
    const drawWidth = Math.max(width, Math.round(labelPx / MAX_LABEL_SHARE));
    const labelShare = labelPx / drawWidth;

    el.style.height = `${height}px`;

    // keep what was drawn, under the alleles' real names: `sets` has been
    this.drawnCombinations = (combinations as readonly {
      elems?: readonly unknown[]; sets?: ReadonlySet<{ name?: string }>;
    }[]).map(c => ({
      alleles: [...(c.sets ?? [])].map(set => this.fullNameOf.get(set.name ?? '') ?? set.name ?? ''),
      count: c.elems?.length ?? 0,
    }));

    el.innerHTML = '';
    UpSetJS.renderUpSet(el, {
      sets, combinations, width: drawWidth, height,
      widthRatios: [SET_CHART_SHARE, labelShare],
      fontSizes: { setLabel: '10px', axisTick: '9px', chartLabel: '11px' },
      selection: this.selectionState as never,
      onHover: (set: unknown) => {
        this.selectionState = set;
        this.scheduleRender();
      },
      // a set is one allele; a combination of one element is a single subject
      onClick: (selected) => {
        const chosen = selected as unknown as
          { name?: string; type?: string; elems?: readonly { name?: string }[] };

        if (chosen?.type === 'set' && chosen.name) {
          // the label may be shortened; drill on the allele it stands for
          this.drill.drill('allele', this.fullNameOf.get(chosen.name) ?? chosen.name);
        } else if (chosen?.elems?.length === 1 && chosen.elems[0]?.name) {
          this.drill.drill('sample', chosen.elems[0].name);
        }
      },
    });
  }
}
