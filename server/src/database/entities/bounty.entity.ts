import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bounties')
export class BountyEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  bountyId: number;

  @Column()
  targetContract: string;

  @Column({ nullable: true })
  creator: string;

  @Column({ nullable: true })
  rewardAmount: string; // in ETH

  @Column({ nullable: true })
  severityThreshold: string; // Low | Medium | High | Critical

  @Column({ nullable: true })
  deadline: string; // ISO date string

  @Column({ default: true })
  active: boolean;

  @Column({ default: 'PENDING' })
  status: string; // PENDING | ANALYZING | SECURE | INCONCLUSIVE | VULNERABLE | SUBMITTED | VERIFIED

  @Column({ nullable: true })
  vulnerabilitiesFound: number;

  @Column({ type: 'timestamp', nullable: true })
  scannedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
