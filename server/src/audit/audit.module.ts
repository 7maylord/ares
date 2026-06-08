import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AnalyzerModule } from '../analyzer/analyzer.module';

@Module({
  imports: [BlockchainModule, AnalyzerModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
