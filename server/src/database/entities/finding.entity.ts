import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('findings')
export class FindingEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  findingId: number; // on-chain ID — set after FindingSubmitted event

  @Column()
  bountyId: number;

  @Column()
  targetContract: string;

  @Column({ nullable: true })
  agent: string;

  @Column({ nullable: true })
  title: string;

  @Column({ default: 'Medium' })
  severity: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  pocSketch: string;

  @Column({ type: 'text', nullable: true })
  remediation: string;

  @Column({ default: 'Pending' })
  status: string; // Pending | Verified | Rejected

  @Column({ nullable: true })
  txHash: string; // submission tx

  @Column({ nullable: true })
  payoutTxHash: string; // escrow verify / payout tx

  @CreateDateColumn()
  submittedAt: Date;
}
