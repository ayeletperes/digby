import {
  AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
    /* Width comes from the column; height is set per render from the number of sets. */
    .upset-chart { width: 100%; min-width: 0; overflow-x: auto; }

    .upset-status { margin: 0.5rem 0; font-size: 0.85rem; color: #5f6368; }
    .upset-status.error { color: #d62839; }
  `],
  standalone: true,
  imports: [CommonModule, ScopeNoteComponent, PlotExportComponent],
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

  constructor(private refbookService: RefbookService, private host: ElementRef<HTMLElement>,
              private drill: DashDrillService) {}

  /**
   * The chart container.
   *
   * Found from the host rather than with @ViewChild: this component is created
   * through NgComponentOutlet, where the view query was not resolving, leaving
   * every render a no-op against an undefined element.
   */
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
      // new chart before the old one is cleared; coalesce into one frame
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
    // while the page is not compositing (a background tab, or a hidden pane), which
    // left the chart permanently blank instead of merely late.
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
      // no clue why, so surface it rather than failing silently
      this.error = `Could not draw the plot: ${(e as Error)?.message ?? e}`;
      el.innerHTML = '';
    }
  }

  /** Shortened set label back to the allele it stands for, for the drill. */
  private fullNameOf = new Map<string, string>();

  /**
   * The figure's numbers: which alleles a subject carries, and how many subjects
   * carry exactly that set. One row per combination, the alleles in full - the
   * shortened labels are for the chart, not for a file someone will join on.
   */
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

  private drawUpset(el: HTMLDivElement, width: number) {
    const { sets, combinations } = UpSetJS.extractCombinations(this.zygosityData.samples);

    // Shorten the labels, but only after extraction: the set name is the set's
    // identity here, so shortening the input would merge two alleles that differ
    // only in which substitutions they carry. Collisions keep their full name.
    const display = shortenAlleleNames(sets.map(set => set.name ?? ''));
    this.fullNameOf = new Map();
    for (const set of sets) {
      const full = set.name ?? '';
      const short = display.get(full) ?? full;
      this.fullNameOf.set(short, full);
      (set as { name: string }).name = short;
    }

    // The set list is drawn down the left, so height follows it. There is no upper
    // bound: capping it does not fit more rows in, it overlaps them - at 720px a
    // gene with 34 alleles had 24 of them sharing 12 rows. The container scrolls.
    const height = Math.max(280, 180 + sets.length * ROW_PX);

    // Allele names are long (IGHV1-2*02_c135t and worse), and the default label
    // column is 19% of the width, which truncates them. Size it from the longest
    // name instead, and widen the chart rather than squeezing the matrix when that
    // leaves too little for it - the container scrolls.
    const longest = sets.reduce((n, set) => Math.max(n, (set.name ?? '').length), 0);
    const labelPx = Math.min(320, Math.max(90, longest * LABEL_CHAR_PX));
    const drawWidth = Math.max(width, Math.round(labelPx / MAX_LABEL_SHARE));
    const labelShare = labelPx / drawWidth;

    el.style.height = `${height}px`;

    // keep what was drawn, under the alleles' real names: `sets` has been
    // rewritten to the shortened labels by this point
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
