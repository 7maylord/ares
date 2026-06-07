import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BlockchainModule } from './blockchain/blockchain.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { SubmitterModule } from './submitter/submitter.module';
import { BountiesModule } from './bounties/bounties.module';
import { FindingsModule } from './findings/findings.module';
import { EventsModule } from './events/events.module';
import { TargetEntity } from './database/entities/target.entity';
import { BountyEntity } from './database/entities/bounty.entity';
import { FindingEntity } from './database/entities/finding.entity';
import { EventLogEntity } from './database/entities/event-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [TargetEntity, BountyEntity, FindingEntity, EventLogEntity],
        synchronize: true,
        ssl: { rejectUnauthorized: false },
      }),
    }),
    BlockchainModule,
    AnalyzerModule,
    SubmitterModule,
    BountiesModule,
    FindingsModule,
    EventsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
