import { createConfig } from "@privy-io/wagmi";
import { http } from "viem";

export const mantleSepolia = {
  id: 5003,
  name: "Mantle Sepolia",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.sepolia.mantle.xyz"] } },
  blockExplorers: {
    default: { name: "Mantlescan", url: "https://sepolia.mantlescan.xyz" },
  },
  testnet: true,
} as const;

export const wagmiConfig = createConfig({
  chains: [mantleSepolia],
  transports: {
    [mantleSepolia.id]: http("https://rpc.sepolia.mantle.xyz"),
  },
});
