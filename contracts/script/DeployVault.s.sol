// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {BountyPool} from "../src/BountyPool.sol";
import {VulnerableVault} from "../src/targets/VulnerableVault.sol";

/// Usage:
///   forge script script/DeployVault.s.sol \
///     --rpc-url $MANTLE_SEPOLIA_RPC_URL \
///     --broadcast \
///     --private-key $PRIVATE_KEY
contract DeployVault is Script {
    uint256 constant REWARD   = 10 ether;
    uint256 constant DAYS_30  = 30 days;
    BountyPool.Severity constant SEVERITY = BountyPool.Severity.Low;

    function run() external {
        uint256 pk          = vm.envUint("PRIVATE_KEY");
        address poolAddress = vm.envAddress("POOL_ADDRESS");
        BountyPool pool     = BountyPool(payable(poolAddress));

        vm.startBroadcast(pk);

        VulnerableVault vault = new VulnerableVault();
        console.log("VulnerableVault:", address(vault));

        uint256 id = pool.createBounty{value: REWARD}(
            address(vault),
            REWARD,
            SEVERITY,
            block.timestamp + DAYS_30,
            new address[](0)
        );
        console.log("Bounty #%d created - 10 MNT reward", id);

        vm.stopBroadcast();
    }
}
