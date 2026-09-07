import {
  Component, ElementRef, EventEmitter, HostListener, Input, Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CheckOption {
  value: string;
  label: string;
  /** Optional count shown after the label. */
  detail?: string | number;
  /** Heading to list this option under. Options without one are listed first. */
  group?: string;
}

interface OptionGroup {
  name: string;
  options: CheckOption[];
}

/** A multi-select that reads as one form control. */
@Component({
  selector: 'app-check-dropdown',
  templateUrl: './check-dropdown.component.html',
  styleUrls: ['./check-dropdown.component.scss'],
  standalone: true,
  imports: [CommonModule],
})
export class CheckDropdownComponent {
  @Input() label = '';
  @Input() options: CheckOption[] = [];
  @Input() selected: string[] = [];
  @Input() disabled = false;
  /** Wording for the state where nothing is ticked, which means no filtering. */
  @Input() allLabel = 'All';

  @Output() selectedChange = new EventEmitter<string[]>();

  open = false;

  constructor(private host: ElementRef<HTMLElement>) {}

  /** Options under their headings. */
  get groups(): OptionGroup[] {
    const byName = new Map<string, CheckOption[]>();

    for (const option of this.options) {
      const name = option.group ?? '';
      const list = byName.get(name);
      list ? list.push(option) : byName.set(name, [option]);
    }

    return [...byName.entries()]
      .map(([name, options]) => ({ name, options }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get isGrouped(): boolean {
    return this.options.some(option => !!option.group);
  }

  selectGroup(group: OptionGroup): void {
    const values = group.options.map(o => o.value);
    const allOn = values.every(v => this.isOn(v));
    const next = allOn
      ? this.selected.filter(v => !values.includes(v))
      : [...new Set([...this.selected, ...values])];

    this.selectedChange.emit(this.options.filter(o => next.includes(o.value)).map(o => o.value));
  }

  groupState(group: OptionGroup): 'none' | 'some' | 'all' {
    const chosen = group.options.filter(o => this.isOn(o.value)).length;
    return chosen === 0 ? 'none' : chosen === group.options.length ? 'all' : 'some';
  }

  /** Close when the click lands outside, the way a native select behaves. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.open && !this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    this.open = false;
  }

  get summary(): string {
    if (!this.selected.length) {
      return `${this.allLabel} (${this.options.length})`;
    }
    if (this.selected.length === 1) {
      return this.options.find(o => o.value === this.selected[0])?.label ?? this.selected[0];
    }
    return `${this.selected.length} of ${this.options.length}`;
  }

  isOn(value: string): boolean {
    return this.selected.includes(value);
  }

  toggle(value: string): void {
    const next = this.isOn(value)
      ? this.selected.filter(v => v !== value)
      : [...this.selected, value];
    // keep the caller's order stable rather than click order
    this.selectedChange.emit(this.options.filter(o => next.includes(o.value)).map(o => o.value));
  }

  clear(): void {
    this.selectedChange.emit([]);
  }

  selectAll(): void {
    this.selectedChange.emit(this.options.map(o => o.value));
  }

  get allSelected(): boolean {
    return this.options.length > 0 && this.selected.length === this.options.length;
  }
}
