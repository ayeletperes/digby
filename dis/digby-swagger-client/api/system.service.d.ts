import { HttpClient, HttpHeaders, HttpResponse, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Configuration } from '../configuration';
import * as i0 from "@angular/core";
export declare class SystemService {
    protected httpClient: HttpClient;
    protected basePath: string;
    defaultHeaders: HttpHeaders;
    configuration: Configuration;
    constructor(httpClient: HttpClient, basePath: string, configuration: Configuration);
    /**
     * @param consumes string[] mime-types
     * @return true: consumes contains 'multipart/form-data', false: otherwise
     */
    private canConsumeForm;
    /**
     * Return internal configuration details
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getConfigApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getConfigApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getConfigApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     *
     *
     * @param username
     * @param password
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getLoginApi(username: string, password: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getLoginApi(username: string, password: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getLoginApi(username: string, password: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     *
     *
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getRefreshApi(observe?: 'body', reportProgress?: boolean): Observable<any>;
    getRefreshApi(observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getRefreshApi(observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    static ɵfac: i0.ɵɵFactoryDeclaration<SystemService, [null, { optional: true; }, { optional: true; }]>;
    static ɵprov: i0.ɵɵInjectableDeclaration<SystemService>;
}
//# sourceMappingURL=system.service.d.ts.map