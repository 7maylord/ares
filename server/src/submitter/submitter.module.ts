import { Module } from '@nestjs/common';
import { SubmitterService } from './submitter.service';
import { EscrowService } from './escrow.service';
import { WalletMutex } from './wallet-mutex.service';

@Module({
  providers: [SubmitterService, EscrowService, WalletMutex],
  exports: [SubmitterService, EscrowService, WalletMutex],
})
export class SubmitterModule {}
