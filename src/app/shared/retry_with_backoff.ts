import { Observable, timer, throwError } from 'rxjs';
import { retry } from 'rxjs/operators';

export function retryWithBackoff(delayMs = 1000, maxRetry = 3, backoffMs = 1000) {
  return (src: Observable<any>) =>
    src.pipe(
      retry({
        count: maxRetry,
        delay: (error, retryCount) => {
          // a 4xx is the server's answer, not a failure to reach it: retrying
          // one only delays the message the user needs to see
          if (error?.status >= 400 && error?.status < 500) {
            return throwError(() => error);
          }
          const backoffTime = delayMs + (retryCount - 1) * backoffMs;
          return timer(backoffTime);
        }
      })
    );
}
