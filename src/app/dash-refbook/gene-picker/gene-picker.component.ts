import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { familyOf, segmentOf } from '../../shared/models/gene-naming';

interface GeneGroup {
  family: string;
  genes: string[];
}

/** Multi-select over the genes of a locus. */
@Component({
  selector: 'app-gene-picker',
  templateUrl: './gene-picker.component.html',
  styleUrls: ['./gene-picker.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class GenePickerComponent implements OnChanges {
  /** Genes of the chosen segment, already narrowed by the caller. */
  @Input() genes: string[] = [];
  @Input() selected: string[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
  /** Panels draw one chart per gene, so the selection is capped. */
  @Input() max = 3;

  @Output() selectedChange = new EventEmitter<string[]>();

  search = '';
  groups: GeneGroup[] = [];
  shown = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['genes']) {
      this.search = '';
    }
    this.buildGroups();
  }

  private buildGroups(): void {
    const term = this.search.trim().toUpperCase();
    const matching = term
      ? this.genes.filter(gene => gene.toUpperCase().includes(term))
      : [...this.genes];

    const byFamily = new Map<string, string[]>();
    for (const gene of matching) {
      const family = familyOf(gene);
      (byFamily.get(family) ?? byFamily.set(family, []).get(family)).push(gene);
    }

    this.shown = matching.length;
    this.groups = [...byFamily.entries()]
      .map(([family, genes]) => ({ family, genes }))
      .sort((a, b) => a.family.localeCompare(b.family, undefined, { numeric: true }));
  }

  onSearchChange(): void {
    this.buildGroups();
  }

  isSelected(gene: string): boolean {
    return this.selected.includes(gene);
  }

  get isFull(): boolean {
    return this.selected.length >= this.max;
  }

  /** True when picking this gene is not possible because the cap is reached. */
  isBlocked(gene: string): boolean {
    return this.isFull && !this.isSelected(gene);
  }

  toggle(gene: string): void {
    if (this.isSelected(gene)) {
      this.emit(this.selected.filter(g => g !== gene));
    } else if (!this.isFull) {
      this.emit([...this.selected, gene]);
    }
  }

  clear(): void {
    this.emit([]);
  }

  private emit(next: string[]): void {
    this.selected = next;
    this.selectedChange.emit(next);
  }
}
