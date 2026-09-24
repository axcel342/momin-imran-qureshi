import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from '../config/env';
import { CLOCK, systemClock } from './domain/clock';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig(process.env) },
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [APP_CONFIG, CLOCK],
})
export class CoreModule {}
