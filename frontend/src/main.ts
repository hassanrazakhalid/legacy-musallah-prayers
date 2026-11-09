import { keepLaunchParams } from './app/core/launch-params';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

keepLaunchParams();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
