import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('event_logs')
export class EventLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  type: string; // BountyCreated | FindingSubmitted | VerificationPassed | VerificationFailed | AnalysisStarted

  @Column({ type: 'text' })
  message: string;

  @Column({ nullable: true })
  txHash: string;

  @CreateDateColumn()
  timestamp: Date;
}
