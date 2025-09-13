import {AfterViewInit, Component, Injectable, Output, OnInit, ViewEncapsulation, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GenomicService } from '../../../../projects/digby-swagger-client/api/genomic.service';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import {catchError, debounceTime} from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import {HttpErrorResponse} from '@angular/common/http';
import { IDropdownSettings } from 'ng-multiselect-dropdown';
import {AvailableSpeciesAndData, SpeciesGeneSelection, testAvailableSpeciesAndData} from './species-gene-selector.model';

@Component({
  selector: 'app-species-gene-selector',
  templateUrl: './species-gene-selector.component.html',
  styleUrls: ['./species-gene-selector.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [FormsModule]
})

@Injectable({
  providedIn: 'root'
})

export class SpeciesGeneSelectorComponent implements OnInit, AfterViewInit {
  @Output() selectionChange = new EventEmitter<SpeciesGeneSelection>();
  isFetching: boolean;
  availableSpeciesAndData: AvailableSpeciesAndData = {
    species: ['Human','Rhesus Macque'],
    chains: {
      'Human': ['IGHV','IGHD','IGHJ','IGKV','IGKJ','IGLV','IGLJ'],
      'Rhesus Macque': ['IGHV','IGHD','IGHJ','IGKV','IGKJ','IGLV','IGLJ']
    }
  };
  selection: SpeciesGeneSelection;
  availableAsc: string[];
  error: string;


  constructor(private refbookService: RefbookService) { }

  ngOnInit() {
    this.selection = {
      species: this.availableSpeciesAndData.species[0],
      chain: this.availableSpeciesAndData.chains[this.availableSpeciesAndData.species[0]][0],
      asc: ''
    }

    this.isFetching = true;
    this.refbookService.getSpeciesApi()
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          console.error('getSpeciesApi ERROR:', err);
          this.error = err;
          return EMPTY;
        })
      )
      .subscribe((data: AvailableSpeciesAndData) => {
        this.isFetching = false;
        this.availableSpeciesAndData = data;
        this.selection.species = this.availableSpeciesAndData.species[0];
        this.selection.chain = this.availableSpeciesAndData.chains[this.availableSpeciesAndData.species[0]][0];
        this.speciesChange();
      });
  }

  ngAfterViewInit(): void {


  }


  handleError(error: HttpErrorResponse) {
    this.isFetching = false;
  }

  speciesChange() {
    this.selection.chain = this.availableSpeciesAndData.chains[this.selection.species][0];
    this.chainChange()
  }

 chainChange() {
    this.isFetching = true;
    this.refbookService.getAscsInChainApi(this.selection.species, this.selection.chain)
      .pipe(
        retryWithBackoff(),
        catchError(err => {
          this.error = err;
          return EMPTY;
        })
      )
      .subscribe((data: string[]) => {
        this.isFetching = false;
        this.availableAsc = data;
        this.selection.asc = this.availableAsc.length ? this.availableAsc[0] : '';
        this.ascChange();
      });


  }

  ascChange() {
    this.selectionChange.emit(this.selection);
  }
}

function symmetricDifference(setA, setB) {
    const difference = new Set(setA);
    for (const elem of setB) {
        if (difference.has(elem)) {
            difference.delete(elem);
        } else {
            difference.add(elem);
        }
    }
    return difference;
}
