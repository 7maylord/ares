// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @dev BUG 1 — Spot price oracle: getPrice() reads balances in the same tx, manipulable by flash loan
/// @dev BUG 2 — No slippage protection in swap(), attacker can sandwich for infinite profit
/// @dev BUG 3 — addLiquidity() accepts 0 amounts, minting LP shares for free
contract NaiveAMM {
    IERC20 public tokenA;
    IERC20 public tokenB;

    uint256 public reserveA;
    uint256 public reserveB;
    mapping(address => uint256) public lpShares;
    uint256 public totalShares;

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    // BUG: no minimum liquidity, no zero-amount guard
    function addLiquidity(uint256 amountA, uint256 amountB) external {
        tokenA.transferFrom(msg.sender, address(this), amountA);
        tokenB.transferFrom(msg.sender, address(this), amountB);

        uint256 shares = totalShares == 0 ? amountA : (amountA * totalShares) / reserveA;
        lpShares[msg.sender] += shares;
        totalShares += shares;

        reserveA += amountA;
        reserveB += amountB;
    }

    // BUG: spot price — reads live balances, trivially manipulable
    function getPrice() external view returns (uint256) {
        return (reserveB * 1e18) / reserveA;
    }

    // BUG: no slippage parameter — sandwich attacks trivial
    function swap(uint256 amountAIn) external returns (uint256 amountBOut) {
        tokenA.transferFrom(msg.sender, address(this), amountAIn);

        // constant product without fee
        amountBOut = (amountAIn * reserveB) / (reserveA + amountAIn);

        reserveA += amountAIn;
        reserveB -= amountBOut;

        tokenB.transfer(msg.sender, amountBOut);
    }
}
