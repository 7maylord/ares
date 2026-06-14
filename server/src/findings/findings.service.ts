import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FindingEntity } from '../database/entities/finding.entity';

@Injectable()
export class FindingsService {
  constructor(
    @InjectRepository(FindingEntity) private readonly repo: Repository<FindingEntity>,
  ) {}

  async create(dto: Partial<FindingEntity>): Promise<FindingEntity> {
    return this.repo.save(this.repo.create(dto));
  }

  async findAll(): Promise<FindingEntity[]> {
    return this.repo.find({ order: { submittedAt: 'DESC' } });
  }

  async updateById(id: number, dto: Partial<FindingEntity>): Promise<void> {
    await this.repo.update(id, dto);
  }

  async updateByBountyId(bountyId: number, dto: Partial<FindingEntity>): Promise<void> {
    await this.repo.update({ bountyId }, dto);
  }

  async findByBountyId(bountyId: number): Promise<FindingEntity | null> {
    return this.repo.findOne({ where: { bountyId }, order: { submittedAt: 'DESC' } });
  }

  async findAllByContract(targetContract: string): Promise<FindingEntity[]> {
    return this.repo.find({ where: { targetContract }, order: { submittedAt: 'DESC' } });
  }
}
