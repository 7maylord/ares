import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BlockchainModule } from './blockchain/blockchain.module';
import { AnalyzerModule } from './analyzer/analyzer.module';
import { SubmitterModule } from './submitter/submitter.module';
import { TargetEntity } from './database/entities/target.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make env vars accessible everywhere
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [TargetEntity],
        synchronize: true, // Only for development/MVP!
        ssl: {
          rejectUnauthorized: false, // Required for Supabase
        },
      }),
    }),
    BlockchainModule,
    AnalyzerModule,
    SubmitterModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
