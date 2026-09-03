import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/** All a card needs. */
export interface GalleryPanel {
  id: string;
  label: string;
  group: string;
  description: string;
}

/** What the dashboard can do, as cards, for someone who has not been here before. */
@Component({
  selector: 'app-panel-gallery',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './panel-gallery.component.html',
  styleUrls: ['./panel-gallery.component.scss'],
})
export class PanelGalleryComponent {
  @Input() panels: GalleryPanel[] = [];
  @Input() groups: string[] = [];
  /** Where the cards say the figures come from. */
  @Input() species = '';
  @Input() locus = '';
  /** Null when the panel can be opened, otherwise why it cannot. */
  @Input() blocked: (panel: GalleryPanel) => string | null = () => null;
  /** Thumbnails by panel id, merged over the ones below. */
  @Input() art: Record<string, string> = {};

  @Output() opened = new EventEmitter<GalleryPanel>();

  constructor(private sanitizer: DomSanitizer) {}

  panelsIn(group: string): GalleryPanel[] {
    return this.panels.filter(panel => panel.group === group);
  }

  open(panel: GalleryPanel): void {
    this.opened.emit(panel);      // a blocked card is disabled and cannot click
  }

  /** A drawing of the figure's shape, not a screenshot. */
  thumbnail(id: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      this.art[id] ?? THUMBNAILS[id] ?? THUMBNAILS['default']);
  }
}

/** A thumbnail is a 120x72 drawing. Exported so a caller can build its own. */
export const thumb = (body: string) =>
  `<svg viewBox="0 0 120 72" role="img" aria-hidden="true">${body}</svg>`;

const t = thumb;

const BAR = 'var(--vdj-teal, #188080)';
const ALT = '#f2864b';
const FAINT = 'rgba(24,128,128,0.28)';

const THUMBNAILS: Record<string, string> = {
  overview: t(`
    <rect x="14" y="10" width="66" height="7" rx="2" fill="${BAR}"/>
    <rect x="14" y="19" width="88" height="7" rx="2" fill="${ALT}"/>
    <rect x="14" y="30" width="34" height="7" rx="2" fill="${BAR}"/>
    <rect x="14" y="39" width="48" height="7" rx="2" fill="${ALT}"/>
    <rect x="14" y="50" width="18" height="7" rx="2" fill="${BAR}"/>
    <line x1="12" y1="6" x2="12" y2="62" stroke="${FAINT}" stroke-width="1.5"/>`),

  sunburst: t(`
    <g transform="translate(60 36)">
      <circle r="10" fill="none" stroke="${FAINT}" stroke-width="1.5"/>
      <path d="M0-30A30 30 0 0 1 26 15L13 8A15 15 0 0 0 0-15Z" fill="${BAR}"/>
      <path d="M26 15A30 30 0 0 1-26 15L-13 8A15 15 0 0 0 13 8Z" fill="${ALT}" opacity="0.85"/>
      <path d="M-26 15A30 30 0 0 1 0-30L0-15A15 15 0 0 0-13 8Z" fill="${BAR}" opacity="0.55"/>
    </g>`),

  names: t(`
    <rect x="14" y="14" width="40" height="6" rx="2" fill="${BAR}"/>
    <rect x="62" y="14" width="44" height="6" rx="2" fill="${FAINT}"/>
    <rect x="14" y="28" width="40" height="6" rx="2" fill="${BAR}"/>
    <rect x="62" y="28" width="34" height="6" rx="2" fill="${FAINT}"/>
    <rect x="14" y="42" width="40" height="6" rx="2" fill="${BAR}"/>
    <rect x="62" y="42" width="40" height="6" rx="2" fill="${FAINT}"/>`),

  alignment: t(`
    <g font-family="ui-monospace,monospace" font-size="11" fill="${BAR}">
      <text x="12" y="22">- - - a - -</text>
      <text x="12" y="40" fill="${ALT}">- - t - - -</text>
      <text x="12" y="58">- - - - - g</text>
    </g>`),

  tree: t(`
    <g fill="none" stroke="${BAR}" stroke-width="2">
      <path d="M20 14H44V30H20"/>
      <path d="M20 46H36V30"/>
      <path d="M44 22H72V38H36"/>
      <path d="M72 30H100"/>
    </g>
    <g fill="${BAR}">
      <circle cx="20" cy="14" r="3"/><circle cx="20" cy="30" r="3"/><circle cx="20" cy="46" r="3"/>
    </g>`),

  usage: t(`
    <line x1="12" y1="6" x2="12" y2="62" stroke="${FAINT}" stroke-width="1.5"/>
    <g stroke="${BAR}" stroke-width="2">
      <line x1="26" y1="18" x2="72" y2="18"/><line x1="26" y1="40" x2="60" y2="40"/>
    </g>
    <rect x="36" y="12" width="22" height="12" rx="2" fill="${BAR}" opacity="0.8"/>
    <rect x="34" y="34" width="18" height="12" rx="2" fill="${ALT}" opacity="0.8"/>
    <g fill="${BAR}" opacity="0.6">
      <circle cx="30" cy="18" r="2"/><circle cx="66" cy="18" r="2"/><circle cx="56" cy="40" r="2"/>
    </g>`),

  zygosity: t(`
    <rect x="20" y="10" width="7" height="18" rx="2" fill="${BAR}"/>
    <rect x="34" y="16" width="7" height="12" rx="2" fill="${BAR}"/>
    <rect x="48" y="20" width="7" height="8" rx="2" fill="${BAR}"/>
    <g fill="${FAINT}">
      <circle cx="23.5" cy="40" r="4"/><circle cx="37.5" cy="40" r="4"/><circle cx="51.5" cy="40" r="4"/>
      <circle cx="23.5" cy="54" r="4"/><circle cx="37.5" cy="54" r="4"/><circle cx="51.5" cy="54" r="4"/>
    </g>
    <g fill="${ALT}">
      <circle cx="23.5" cy="40" r="4"/><circle cx="37.5" cy="54" r="4"/><circle cx="51.5" cy="40" r="4"/>
    </g>
    <line x1="51.5" y1="40" x2="51.5" y2="54" stroke="${ALT}" stroke-width="2"/>`),

  allele: t(`
    <circle cx="34" cy="36" r="14" fill="${ALT}" opacity="0.85"/>
    <rect x="58" y="20" width="46" height="6" rx="2" fill="${BAR}"/>
    <rect x="58" y="33" width="34" height="6" rx="2" fill="${FAINT}"/>
    <rect x="58" y="46" width="42" height="6" rx="2" fill="${BAR}" opacity="0.6"/>`),

  default: t(`<rect x="18" y="18" width="84" height="36" rx="4" fill="${FAINT}"/>`),
};
