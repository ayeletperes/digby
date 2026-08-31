import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ExportLayout, ExportTable, ExportTrace, python, safeStem, saveText, table, tsv }
  from './plot-export';

/**
 * Two downloads as buttons under the figure, for a panel that has no Plotly
 * modebar to put them in.
 *
 * Plotly panels use `exportButtons` instead, which puts the same two actions
 * beside "Download plot as a PNG" where they belong. This is for the UpSet
 * plot, which draws its own SVG and has no toolbar.
 */
@Component({
  selector: 'app-plot-export',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (rowCount) {
      <div class="plot-export">
        <button type="button" (click)="downloadData()"
                [title]="rowCount + ' rows, tab separated'">Data (TSV)</button>
        <button type="button" (click)="downloadCode()"
                title="A pandas + matplotlib script that redraws this figure">Python</button>
      </div>
    }
  `,
  styles: [`
    .plot-export { display: flex; gap: 0.35rem; justify-content: flex-end; margin: 0.25rem 0 0; }
    button {
      border: 1px solid var(--vdj-rule, #e7eeed);
      background: #fff;
      color: var(--vdj-body, #455857);
      border-radius: 999px;
      padding: 0.05rem 0.65rem;
      font-size: 0.75rem;
      line-height: 1.6;
      cursor: pointer;
    }
    button:hover { border-color: var(--vdj-teal, #188080); color: var(--vdj-teal-dark, #0f5f5f); }
    button:focus-visible { outline: 2px solid var(--vdj-teal, #188080); outline-offset: 1px; }
  `],
})
export class PlotExportComponent {
  /** The traces the panel handed to Plotly. */
  @Input() data: ExportTrace[] = [];
  /** Its layout, which supplies the axis names as column headings. */
  @Input() layout: ExportLayout = {};
  /** Basename for the downloads, and the figure's title in the script. */
  @Input() name = 'figure';
  /** What this figure is, in one line. */
  @Input() title = '';
  /** The endpoint the panel read, named in the script so the query can be re-run. */
  @Input() source = '';
  /**
   * For a figure whose traces are not its data. A dendrogram's traces are line
   * vertices - exporting those would hand over the drawing instead of the
   * numbers - so it supplies its own table and script.
   */
  @Input() overrideTable: ExportTable = null;
  @Input() overrideScript: string = null;

  get rowCount(): number {
    return this.rows().rows.length;
  }

  private rows(): ExportTable {
    return this.overrideTable ?? table(this.data ?? [], this.layout ?? {});
  }

  private get kind(): string {
    return (this.data ?? []).find(t => t?.type)?.type ?? 'bar';
  }

  private get horizontal(): boolean {
    return (this.data ?? []).some(t => t?.orientation === 'h');
  }

  downloadData(): void {
    this.save(tsv(this.rows()), `${safeStem(this.name)}.tsv`, 'text/tab-separated-values');
  }

  downloadCode(): void {
    const script = this.overrideScript ?? python(this.rows(), {
      title: this.title || this.name,
      source: this.source,
      kind: this.kind,
      horizontal: this.horizontal,
    });
    this.save(script, `${safeStem(this.name)}.py`, 'text/x-python');
  }

  private save(text: string, filename: string, type: string): void {
    saveText(text, filename, type);
  }
}
