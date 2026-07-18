import { Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('used_tx_hashes')
export class UsedTxHashEntity {
  @PrimaryColumn()
  txHash: string;

  @CreateDateColumn()
  usedAt: Date;
}
