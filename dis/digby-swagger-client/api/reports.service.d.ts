import { HttpClient, HttpHeaders, HttpResponse, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Configuration } from '../configuration';
import * as i0 from "@angular/core";
export declare class ReportsService {
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
     *
     *
     * @param species
     * @param genomicDatasets
     * @param repDatasets
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getReportsApi(species?: string, genomicDatasets?: string, repDatasets?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getReportsApi(species?: string, genomicDatasets?: string, repDatasets?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getReportsApi(species?: string, genomicDatasets?: string, repDatasets?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     *
     *
     * @param reportName
     * @param format
     * @param species
     * @param genomicDatasets
     * @param genomicFilters
     * @param repDatasets
     * @param repFilters
     * @param params
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getReportsRunApi(reportName: string, format?: string, species?: string, genomicDatasets?: string, genomicFilters?: string, repDatasets?: string, repFilters?: string, params?: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getReportsRunApi(reportName: string, format?: string, species?: string, genomicDatasets?: string, genomicFilters?: string, repDatasets?: string, repFilters?: string, params?: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getReportsRunApi(reportName: string, format?: string, species?: string, genomicDatasets?: string, genomicFilters?: string, repDatasets?: string, repFilters?: string, params?: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    /**
     *
     *
     * @param jobId
     * @param observe set whether or not to return the data Observable as the body, response or events. defaults to returning the body.
     * @param reportProgress flag to report request and response progress.
     */
    getReportsStatus(jobId: string, observe?: 'body', reportProgress?: boolean): Observable<any>;
    getReportsStatus(jobId: string, observe?: 'response', reportProgress?: boolean): Observable<HttpResponse<any>>;
    getReportsStatus(jobId: string, observe?: 'events', reportProgress?: boolean): Observable<HttpEvent<any>>;
    static ɵfac: i0.ɵɵFactoryDeclaration<ReportsService, [null, { optional: true; }, { optional: true; }]>;
    static ɵprov: i0.ɵɵInjectableDeclaration<ReportsService>;
}
//# sourceMappingURL=reports.service.d.ts.map