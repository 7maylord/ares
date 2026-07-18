import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mantleSepoliaTestnet } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';
import { WalletMutex } from './wallet-mutex.service';

@Injectable()
export class SubmitterService {
  private readonly logger = new Logger(SubmitterService.name);
  private client: any;
  private account: any;
  private poolAbi: any;

  constructor(
    private configService: ConfigService,
    private readonly walletMutex: WalletMutex,
  ) {
    const pk = this.configService.get<string>('AGENT_PRIVATE_KEY');
    if (!pk) {
      throw new Error('AGENT_PRIVATE_KEY environment variable is not defined');
    }
    this.account = privateKeyToAccount(pk as `0x${string}`);
    
    const rpcUrl = this.configService.get<string>('MANTLE_SEPOLIA_RPC_URL');
    this.client = createWalletClient({
      account: this.account,
      chain: mantleSepoliaTestnet,
      transport: http(rpcUrl),
    }).extend(publicActions);

    const abiPath = path.join(__dirname, '..', 'abi', 'BountyPool.abi.json');
    if (fs.existsSync(abiPath)) {
      this.poolAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  private severityToEnum(severity: string): number {
    const map: Record<string, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };
    return map[severity] ?? 2; // default High if unknown
  }

  async submitFinding(
    poolAddress: string,
    bountyId: number,
    pocData: string,
    description: string,
    severity = 'High',
  ) {
    const severityEnum = this.severityToEnum(severity);
    this.logger.log(`Submitting finding for bounty ${bountyId} on pool ${poolAddress} [severity=${severity}/${severityEnum}]`);
    return this.walletMutex.run(async () => {
      const { request } = await this.client.simulateContract({
        address: poolAddress as `0x${string}`,
        abi: this.poolAbi,
        functionName: 'submitFinding',
        args: [BigInt(bountyId), pocData as `0x${string}`, description, severityEnum],
      });
      const hash = await this.client.writeContract(request);
      this.logger.log(`Finding submitted in tx: ${hash}`);
      return hash;
    }).catch((error) => {
      this.logger.error('Failed to submit finding', error);
      throw error;
    });
  }
}
