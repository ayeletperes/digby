import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export type DrillKind = 'allele' | 'sample' | 'gene';

export interface DrillEvent {
  kind: DrillKind;
  value: string;
}

/** Clicks in a panel, on their way back to the dashboard shell. */
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
