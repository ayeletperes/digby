import { Component, Injectable, Input, OnChanges, SimpleChanges, OnInit, ViewEncapsulation } from '@angular/core';
import { RefbookService } from '../../../../projects/digby-swagger-client/api/refbook.service';
import { retryWithBackoff } from '../../shared/retry_with_backoff';
import { catchError } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { SpeciesGeneSelection } from '../species-gene-selector/species-gene-selector.model';
import { AlignmentData } from './dash-refbook-alignment.model';
import * as PlotlyJS from 'plotly.js-dist-min';
import { PlotlyModule } from 'angular-plotly.js';

@Component({
  selector: 'app-dash-refbook-alignment',
  templateUrl: './dash-refbook-alignment.component.html',
  styleUrls: ['./dash-refbook-alignment.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [PlotlyModule],
})

@Injectable({
  providedIn: 'root'
})

export class DashRefbookAlignmentComponent implements OnInit, OnChanges {
  @Input() selection: SpeciesGeneSelection;
  isFetching: boolean;
  error: string;
  alignmentData: AlignmentData = {
    alleles: []
  };

  public graph = {
    data: [
        { x: [],
          y: [],
          z: [],
          text: [],
          type: 'heatmap',
          colorscale: [
            [0/5, 'rgba(16,150,72,0.8)'],   // A (#109648)
            [1/5, 'rgba(37,92,153,0.8)'],   // C (#255C99)
            [2/5, 'rgba(247,179,43,0.8)'],  // G (#F7B32B)
            [3/5, 'rgba(214,40,57,0.8)'],   // T (#D62839)
            [4/5, 'rgba(139,0,139,0.8)'],   // N (#8B008B)
            [1,   'rgba(255,255,255,0.8)']   // gap
          ],
          showscale: false,
          zmin: 0,
          zmax: 5,
          hovertemplate: 'Position: %{x}<br>Allele: %{y}<br>Nucleotide: %{text}<extra></extra>',
          texttemplate: '%{text}',
          textfont: { color: '#212121' },
          xgap: 1,
          ygap: 1,
         },

    ],
    layout: {
      xaxis: { title: 'Position' },
      yaxis: { title: 'Allele', automargin: true },
      margin: { l: 120, r: 10, t: 30, b: 50 },
      font: { family: 'Arial, sans-serif' },
      width: 1500,
      height: 600,
      title: { text: 'Alignment Heatmap' },
      }
  };

  constructor(private refbookService: RefbookService) { }

  ngOnInit() {
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selection'] && changes['selection'].currentValue) {
        const cs = changes['selection'].currentValue;
        this.selection = changes['selection'].currentValue;
        this.refbookService.getAscSeqs(cs.species, cs.chain, cs.asc)
          .pipe(
            retryWithBackoff(),
            catchError(err => {
              this.error = err;
              return EMPTY;
            })
          )
          .subscribe((data: AlignmentData) => {
            this.isFetching = false;
            this.alignmentData = data;
            this.alignmentChart(data.alleles);
          });
    }
  }

  // map each nucleotide (and gaps) to an integer code
  codeMap = {
    A: 0, C: 1, G: 2, T: 3, N: 4,
    '.': 5, '-': 5
  };

  /**
   * Turn list of seq objects into an array of arrays of nucleotides by position.
   */
  reshapeData = (data) => {
    const positions = [];
    data.forEach(row => {
      const seq = row.seq_gapped && row.seq_gapped !== ""
        ? row.seq_gapped.split("")
        : row.seq.split("");
      seq.forEach((nuc, idx) => {
        if (!positions[idx]) positions[idx] = [];
        positions[idx].push(nuc);
      });
    });
    return positions;
  };

  /**
   * Renders a Plotly heatmap into the container with id `stageId`.
   * @param {Array<Object>} data – each row needs at least { allele, seq, seq_gapped? }
   * @param {string} stageId – the DOM id of the div where the chart will go
   */
  alignmentChart(data) {

    const reshaped = this.reshapeData(data);
    const alleles  = data.map(r => r.name);
    const seqLen   = (data[0].seq_gapped || data[0].seq).length;
    const positions = Array.from({length: seqLen}, (_, i) => i + 1);

    // build z (codes) and text (labels) matrices
    const z    = [];
    const text = [];

    data.forEach(row => {
      const seq = row.seq_gapped && row.seq_gapped !== ""
        ? row.seq_gapped.split("")
        : row.seq.split("");
      const zRow    = [];
      const textRow = [];

      seq.forEach((nuc, i) => {
        zRow.push(this.codeMap[nuc] !== undefined ? this.codeMap[nuc] : this.codeMap['N']);
        // only show text on mismatches
        const isDiff = reshaped[i].some(x => x !== nuc);
        textRow.push(isDiff ? nuc : "");
      });

      z.push(zRow);
      text.push(textRow);
    });

    const trace = {
      z: z,
      x: positions,
      y: alleles,
      text,
      type: 'heatmap',
      colorscale: [
        [0/5, 'rgba(16,150,72,0.8)'],   // A (#109648)
        [1/5, 'rgba(37,92,153,0.8)'],   // C (#255C99)
        [2/5, 'rgba(247,179,43,0.8)'],  // G (#F7B32B)
        [3/5, 'rgba(214,40,57,0.8)'],   // T (#D62839)
        [4/5, 'rgba(139,0,139,0.8)'],   // N (#8B008B)
        [1,   'rgba(255,255,255,0.8)']   // gap
      ],
      showscale: false,
      zmin: 0,
      zmax: 5,
      texttemplate: '%{text}',
      textfont: { color: '#212121' },
      xgap: 1,
      ygap: 1,
      hovertemplate: 'Position: %{x}<br>Allele: %{y}<br>Nucleotide: %{text}<extra></extra>'
    };
    //this.graph.layout = {title: 'A Fancy Plot'}
    this.graph.data = [
      {
        x: positions,
        y: alleles,
        z: z,
        text: text,
        type: 'heatmap',
        colorscale: [
          [0/5, 'rgba(16,150,72,0.8)'],   // A (#109648)
          [1/5, 'rgba(37,92,153,0.8)'],   // C (#255C99)
          [2/5, 'rgba(247,179,43,0.8)'],  // G (#F7B32B)
          [3/5, 'rgba(214,40,57,0.8)'],   // T (#D62839)
          [4/5, 'rgba(139,0,139,0.8)'],   // N (#8B008B)
          [1,   'rgba(255,255,255,0.8)']   // gap
        ],
        showscale: false,
        zmin: 0,
        zmax: 5,
        hovertemplate: 'Position: %{x}<br>Allele: %{y}<br>Nucleotide: %{text}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { color: '#212121' },
        xgap: 1,
        ygap: 1
      },
    ];

    this.graph.layout.width = 250+12*positions.length;

    //this.graph.layout = this.chartLayout;
    //this.chartData = trace;
    //this.chartData = {...this.chartData}
  }

  plot_update() {
  }
}
