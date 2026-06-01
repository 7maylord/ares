import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const ANALYSIS_QUEUE = 'analysis';

/**
 * Thin module: only registers the Bull queue connection.
 * QueueService and AnalysisProcessor are provided by BlockchainModule
 * to avoid a circular dependency (BlockchainModule ↔ QueueModule).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<number>('REDIS_PORT') || 6379,
        },
      }),
    }),
    BullModule.registerQueue({ name: ANALYSIS_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
