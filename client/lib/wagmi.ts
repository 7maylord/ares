import { createConfig } from "@privy-io/wagmi";
import { http } from "viem";
import { mantleSepoliaTestnet } from "viem/chains";

export { mantleSepoliaTestnet as mantleSepolia };

export const wagmiConfig = createConfig({
  chains: [mantleSepoliaTestnet],
  transports: {
    [mantleSepoliaTestnet.id]: http("https://rpc.sepolia.mantle.xyz"),
  },
});
