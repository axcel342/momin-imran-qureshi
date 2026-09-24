import { Module } from '@nestjs/common';
import { GetMetricsUseCase } from './get-metrics.use-case';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { MetricsQuery } from './metrics.query';

@Module({ controllers: [HealthController, MetricsController], providers: [MetricsQuery, GetMetricsUseCase] })
export class ObservabilityModule {}
