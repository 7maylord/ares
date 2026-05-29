import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mantleTestnet } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class SubmitterService {
  private readonly logger = new Logger(SubmitterService.name);
  private client: any;
  private account: any;
  private poolAbi: any;

  constructor(private configService: ConfigService) {
    const pk = this.configService.get<string>('AGENT_PRIVATE_KEY') || '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
    this.account = privateKeyToAccount(pk as `0x${string}`);
    
    this.client = createWalletClient({
      account: this.account,
      chain: mantleTestnet,
      transport: http()
    }).extend(publicActions);

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyPool.abi.json');
    if (fs.existsSync(abiPath)) {
      this.poolAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  async submitFinding(poolAddress: string, bountyId: number, pocData: string, description: string) {
    this.logger.log(`Submitting finding for bounty ${bountyId} on pool ${poolAddress}`);
    try {
      const { request } = await this.client.simulateContract({
        address: poolAddress as `0x${string}`,
        abi: this.poolAbi,
        functionName: 'submitFinding',
        args: [
          BigInt(bountyId),
          pocData as `0x${string}`,
          description,
          0 // Severity.High
        ],
      });
      const hash = await this.client.writeContract(request);
      this.logger.log(`Finding submitted in tx: ${hash}`);
      return hash;
    } catch (error) {
      this.logger.error('Failed to submit finding', error);
      throw error;
    }
  }
}
