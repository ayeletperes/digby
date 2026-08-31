import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { environment } from '../../environments/environment';

interface Summary { samples: number; projects: number; datasets: number; species: number; }

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterLink],
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly tools = [
    { id: 'explorer', label: 'Explorer' },
    { id: 'qtl',      label: 'Gene usage QTL' },
    { id: 'reports',  label: 'Reports' },
    { id: 'browser',  label: 'Gene browser' },
    { id: 'api',      label: 'API' },
  ];

  activeSection = 'explorer';

  /** Dashes while loading, so the hero never shifts when the numbers land. */
  statItems = [
    { label: 'samples',  value: '—' },
    { label: 'projects', value: '—' },
    { label: 'datasets', value: '—' },
  ];
  statsFailed = false;

  private observer?: IntersectionObserver;

  constructor(private http: HttpClient,
              private host: ElementRef<HTMLElement>,
              private zone: NgZone) {}

  ngOnInit(): void {
    this.http.get<Summary>(`${environment.apiBasePath}/refbook/summary`)
      .pipe(catchError(() => { this.statsFailed = true; return of(null); }))
      .subscribe(s => {
        if (!s) { return; }
        this.statItems = [
          { label: 'samples',  value: s.samples.toLocaleString() },
          { label: 'projects', value: s.projects.toLocaleString() },
          { label: 'datasets', value: s.datasets.toLocaleString() },
        ];
      });
  }

  ngAfterViewInit(): void {
    const sections = this.tools
      .map(t => this.host.nativeElement.querySelector<HTMLElement>(`#${t.id}`))
      .filter((el): el is HTMLElement => !!el);

    // rootMargin pulls the trigger line below the two sticky bars, so the strip
    // highlights the section you are actually reading rather than the one above
    // zone.js does not patch IntersectionObserver, so the callback lands outside
    // Angular's zone and the underline never repaints. Re-enter to update.
    this.observer = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting && e.target.id !== this.activeSection) {
          this.zone.run(() => this.activeSection = e.target.id);
        }
      }),
      { rootMargin: '-120px 0px -60% 0px' },
    );
    sections.forEach(el => this.observer!.observe(el));
  }

  /** A screenshot that has not been captured yet hides, revealing the frame label. */
  hideShot(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
