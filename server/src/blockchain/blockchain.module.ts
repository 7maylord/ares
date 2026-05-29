import { Module } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { AnalyzerModule } from '../analyzer/analyzer.module';
import { SubmitterModule } from '../submitter/submitter.module';

@Module({
  imports: [AnalyzerModule, SubmitterModule],
  providers: [BlockchainService]
})
export class BlockchainModule {}
