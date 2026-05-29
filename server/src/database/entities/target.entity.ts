import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('targets')
export class TargetEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  contractAddress: string;

  @Column({ nullable: true })
  bountyId: number;

  @Column({ default: 'PENDING' })
  status: string; // PENDING, ANALYZING, VULNERABLE, SAFE, SUBMITTED

  @Column({ nullable: true })
  vulnerabilityType: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
