import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { UsedTxHashEntity } from '../database/entities/used-tx-hash.entity';

@Module({
  imports: [BlockchainModule, AnalyzerModule, TypeOrmModule.forFeature([UsedTxHashEntity])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
