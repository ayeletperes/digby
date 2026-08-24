import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type DrillKind = 'allele' | 'sample' | 'gene';

export interface DrillEvent {
  kind: DrillKind;
  value: string;
}

/**
 * Clicks in a panel, on their way back to the dashboard shell.
 *
 * Panels are created through NgComponentOutlet, which binds inputs but not
 * outputs, so a panel cannot raise an @Output the shell would hear. They push
 * onto this instead; the shell provides it, so the stream is scoped to one
 * dashboard rather than shared application-wide.
 */
@Injectable()
export class DashDrillService {
  private readonly drills = new Subject<DrillEvent>();

  get events$(): Observable<DrillEvent> {
    return this.drills.asObservable();
  }

  drill(kind: DrillKind, value: string): void {
    if (value) {
      this.drills.next({ kind, value });
    }
  }
}
