import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  DataSource, SpeciesGeneSelection, scopeNote,
} from '../../shared/models/species-gene-selection.model';

/** States which samples the figures beside it are counted over. */
@Component({
  selector: 'app-scope-note',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (note) {
      <p class="scope-note"><span class="marker">▾</span>{{ note }}</p>
    }
  `,
  styles: [`
    .scope-note {
      margin: 0 0 0.5rem; padding: 0.25rem 0.5rem;
      background: #fef7e0; border-left: 3px solid #f9ab00; border-radius: 0 3px 3px 0;
      font-size: 0.78rem; color: #5f6368;
    }
    .marker { margin-right: 0.35rem; color: #f9ab00; }
  `],
})
export class ScopeNoteComponent {
  @Input() selection: SpeciesGeneSelection;
  /** The databases the panel reads. */
  @Input() sources: DataSource[] = ['genomic', 'airrseq'];

  get note(): string | null {
    return scopeNote(this.selection, this.sources);
  }
}
