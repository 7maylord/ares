import { Module } from '@nestjs/common';
import { SubmitterService } from './submitter.service';
import { EscrowService } from './escrow.service';

@Module({
  providers: [SubmitterService, EscrowService],
  exports: [SubmitterService, EscrowService],
})
export class SubmitterModule {}
