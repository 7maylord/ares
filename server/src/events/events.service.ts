import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventLogEntity } from '../database/entities/event-log.entity';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(EventLogEntity) private readonly repo: Repository<EventLogEntity>,
  ) {}

  async log(type: string, message: string, txHash?: string): Promise<EventLogEntity> {
    return this.repo.save(this.repo.create({ type, message, txHash }));
  }

  async findRecent(limit = 50): Promise<EventLogEntity[]> {
    return this.repo.find({ order: { timestamp: 'DESC' }, take: limit });
  }
}
