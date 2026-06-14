// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VulnerableVault
 * @notice A yield-bearing vault where users deposit ETH, earn "shares",
 *         and can withdraw principal + rewards. Owner can set the reward rate.
 *
 * !! FOR TESTING ONLY — DO NOT USE IN PRODUCTION !!
 */
contract VulnerableVault {

    address public owner;
    uint256 public rewardRate;       // basis points per block
    uint256 public totalDeposits;
    uint256 public emergencyFee;     // fee taken on emergency withdrawal

    mapping(address => uint256) public balances;
    mapping(address => uint256) public depositBlock;
    mapping(address => bool)    public blacklisted;

    // Bug 1: tx.origin authentication — any contract can bypass this
    modifier onlyOwner() {
        require(tx.origin == owner, "not owner");
        _;
    }

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 reward);

    constructor() {
        owner = msg.sender;
        rewardRate = 100;   // 1% per block
        emergencyFee = 10;  // 10%
    }

    // Bug 2: no reentrancy guard — ETH sent before state cleared
    function deposit() external payable {
        require(msg.value > 0, "zero deposit");
        require(!blacklisted[msg.sender], "blacklisted");

        balances[msg.sender] += msg.value;
        depositBlock[msg.sender] = block.number;
        totalDeposits += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    // Bug 3: reentrancy — balance updated AFTER external call
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient balance");

        // send ETH before updating state
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");

        balances[msg.sender] -= amount;   // ← state updated too late
        totalDeposits -= amount;

        emit Withdraw(msg.sender, amount);
    }

    // Bug 4: integer precision loss — integer division truncates rewards
    // Bug 5: anyone can claim rewards for any address (missing msg.sender check)
    function claimRewards(address user) external {
        uint256 blocks = block.number - depositBlock[user];
        // precision loss: rewardRate * balance / 10000 truncates for small deposits
        uint256 reward = (rewardRate * balances[user] * blocks) / 10000;

        require(address(this).balance >= reward, "insufficient vault balance");

        depositBlock[user] = block.number;

        (bool ok, ) = user.call{value: reward}("");  // Bug 6: reward sent to arbitrary `user` param
        require(ok, "reward transfer failed");

        emit RewardClaimed(user, reward);
    }

    // Bug 7: griefing / DoS — owner can freeze any user permanently
    function blacklist(address user) external onlyOwner {
        blacklisted[user] = true;
        // no un-blacklist function — deposits permanently locked
    }

    // Bug 8: unchecked arithmetic in emergencyFee path (uses unchecked)
    function emergencyWithdraw() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "nothing to withdraw");

        uint256 fee;
        unchecked {
            // Bug 8: if emergencyFee were > 100 this wraps; also fee rounds down
            fee = (bal * emergencyFee) / 100;
        }

        uint256 payout = bal - fee;

        balances[msg.sender] = 0;
        totalDeposits -= bal;

        // Bug 9: reentrancy again — state cleared but ETH sent after; fee stays in vault
        (bool ok, ) = msg.sender.call{value: payout}("");
        require(ok, "transfer failed");
    }

    // Bug 10: owner can drain the entire vault at any time — no timelock, no limit
    function setRewardRate(uint256 rate) external onlyOwner {
        rewardRate = rate;
    }

    // Bug 11: unprotected sweep — anyone can call, drains vault to owner
    function sweepDust() external {
        uint256 dust = address(this).balance - totalDeposits;
        (bool ok, ) = owner.call{value: dust}("");
        require(ok, "sweep failed");
    }

    // Bug 12: front-running — rewardRate change visible in mempool before withdrawal
    function updateFee(uint256 newFee) external onlyOwner {
        emergencyFee = newFee;  // no upper bound — owner can set to 100% and drain
    }

    receive() external payable {}
}
