// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev BUG 1 — Reward calculation uses block.timestamp which miners can manipulate
/// @dev BUG 2 — Anyone can call claimRewards() on behalf of any user (missing msg.sender check)
/// @dev BUG 3 — Integer division truncation allows zero-cost staking for dust amounts
contract InsecureStaking {
    struct Stake {
        uint256 amount;
        uint256 stakedAt;
        address owner;
    }

    mapping(uint256 => Stake) public stakes;
    mapping(address => uint256[]) public userStakes;
    uint256 public nextStakeId;

    uint256 public constant REWARD_RATE = 1e15; // 0.001 ETH per second per ETH staked

    function stake() external payable {
        require(msg.value > 0);
        uint256 id = nextStakeId++;
        stakes[id] = Stake(msg.value, block.timestamp, msg.sender);
        userStakes[msg.sender].push(id);
    }

    // BUG: _to is caller-controlled — attacker passes any victim address
    function claimRewards(uint256 stakeId, address _to) external {
        Stake storage s = stakes[stakeId];
        require(s.amount > 0, "No stake");
        // BUG: no check that msg.sender == s.owner

        // BUG: block.timestamp manipulable by validator
        uint256 elapsed = block.timestamp - s.stakedAt;
        uint256 reward = (s.amount * elapsed * REWARD_RATE) / 1e18;

        s.stakedAt = block.timestamp; // reset
        (bool ok,) = _to.call{value: reward}("");
        require(ok);
    }

    // BUG: no withdrawal auth — anyone can force-unstake any stake
    function unstake(uint256 stakeId) external {
        Stake storage s = stakes[stakeId];
        uint256 amount = s.amount;
        s.amount = 0;
        (bool ok,) = s.owner.call{value: amount}(""); // at least sends to owner
        require(ok);
    }

    receive() external payable {}
}
