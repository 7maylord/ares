import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mantleSepoliaTestnet } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);
  private readonly client: ReturnType<typeof createPublicClient>;
  private readonly agentAddress: `0x${string}`;
  private readonly reputationAddress: `0x${string}`;
  private reputationAbi: any;

  constructor(private readonly configService: ConfigService) {
    const pk = this.configService.get<string>('AGENT_PRIVATE_KEY')!;
    this.agentAddress = privateKeyToAccount(pk as `0x${string}`).address;
    this.reputationAddress = (
      this.configService.get<string>('REPUTATION_ADDRESS') ??
      '0x2986F9236991F156aEfB94F369551a95E67F0aCc'
    ) as `0x${string}`;

    this.client = createPublicClient({
      chain: mantleSepoliaTestnet,
      transport: http(this.configService.get<string>('MANTLE_SEPOLIA_RPC_URL') ?? 'https://rpc.sepolia.mantle.xyz'),
    });

    const abiPath = path.join(__dirname, '..', 'abi', 'ReputationLedger.abi.json');
    if (fs.existsSync(abiPath)) {
      this.reputationAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    }
  }

  @Get()
  async getStats() {
    if (!this.reputationAbi) {
      return { address: this.agentAddress, reputationScore: 0, successful: 0, failed: 0, total: 0 };
    }
    try {
      const [score, successful, failed, total] = await this.client.readContract({
        address: this.reputationAddress,
        abi: this.reputationAbi,
        functionName: 'getAgentStats',
        args: [this.agentAddress],
      }) as [bigint, bigint, bigint, bigint];

      const balance = await this.client.getBalance({ address: this.agentAddress });

      return {
        address: this.agentAddress,
        reputationScore: Number(score),
        successful: Number(successful),
        failed: Number(failed),
        total: Number(total),
        balanceMnt: formatEther(balance),
      };
    } catch (err) {
      this.logger.error('Failed to read agent stats', err);
      return { address: this.agentAddress, reputationScore: 0, successful: 0, failed: 0, total: 0, balanceMnt: '0' };
    }
  }
}
