import {Component, OnInit, ViewChild} from '@angular/core';
import { Subscription } from 'rxjs';
import {WordpressService} from "./wordpress.service";
import {AuthService} from "../auth/auth.service";
import {SysConfig} from "../auth/sysconfig.model";

import { RouterLink } from '@angular/router';


@Component({
    selector: 'app-home',
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
    standalone: true
})
export class HomeComponent implements OnInit {
  loadedNewsPosts = [];
  loadingNews = false;
  errorNews = null;
  loadedHelpPosts = [];
  loadingHelp = false;
  errorHelp = null;
  wpConfig = new SysConfig(true, '', '', '');

  constructor( private wordpressService: WordpressService,
               private authService: AuthService ) {  }

  fillNews() {
    this.loadingNews = true;
    this.wordpressService.fetchNews().subscribe(
      posts => {
        this.loadedNewsPosts = posts;
        this.loadingNews = false;
      },
      error => {
        this.errorNews = error;
        this.loadingNews = false;
      }
    );
  }

  fillHelp() {
    this.loadingHelp = true;
    this.wordpressService.fetchHelp().subscribe(
      posts => {
        this.loadedHelpPosts = posts;
        this.loadingHelp = false;
      },
      error => {
        this.errorHelp = error;
        this.loadingHelp = false;
      }
    );
  }

  ngOnInit() {
      this.wordpressService.sysConfig.subscribe(
        sysConfig => {
          if (sysConfig.wp_rest != '') {
            this.wpConfig = sysConfig;
            this.fillNews();
            this.fillHelp();
          } else {
            console.log("config is empty");
          }
        },
      error => {
        this.errorHelp = error;
      }
    );
  }
}
