import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BountyEntity } from '../database/entities/bounty.entity';

@Injectable()
export class BountiesService {
  constructor(
    @InjectRepository(BountyEntity) private readonly repo: Repository<BountyEntity>,
  ) {}

  async create(dto: Partial<BountyEntity>): Promise<BountyEntity> {
    const existing = await this.repo.findOne({ where: { bountyId: dto.bountyId } });
    if (existing) return existing;
    return this.repo.save(this.repo.create(dto));
  }

  async findByBountyId(bountyId: number): Promise<BountyEntity | null> {
    return this.repo.findOne({ where: { bountyId } });
  }

  async findByTargetContract(targetContract: string): Promise<BountyEntity | null> {
    return this.repo.findOne({
      where: { targetContract },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<BountyEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async updateByBountyId(bountyId: number, dto: Partial<BountyEntity>): Promise<void> {
    await this.repo.update({ bountyId }, dto);
  }
}
