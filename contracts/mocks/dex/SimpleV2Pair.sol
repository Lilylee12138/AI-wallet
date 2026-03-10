// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract SimpleV2Pair {
    address public immutable token0;
    address public immutable token1;

    uint112 private reserve0;
    uint112 private reserve1;

    constructor(address _token0, address _token1) {
        require(_token0 != _token1, 'IDENTICAL_ADDRESSES');
        require(_token0 != address(0) && _token1 != address(0), 'ZERO_ADDRESS');

        token0 = _token0;
        token1 = _token1;
    }

    function getReserves() external view returns (uint112, uint112) {
        return (reserve0, reserve1);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external {
        require(amount0 > 0 && amount1 > 0, 'INSUFFICIENT_LIQUIDITY_INPUT');

        IERC20(token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(token1).transferFrom(msg.sender, address(this), amount1);

        reserve0 += uint112(amount0);
        reserve1 += uint112(amount1);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, 'INSUFFICIENT_INPUT');
        require(tokenIn == token0 || tokenIn == token1, 'INVALID_TOKEN_IN');

        bool zeroForOne = tokenIn == token0;

        uint256 reserveIn = zeroForOne ? reserve0 : reserve1;
        uint256 reserveOut = zeroForOne ? reserve1 : reserve0;

        require(reserveIn > 0 && reserveOut > 0, 'INSUFFICIENT_LIQUIDITY');

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;

        amountOut = numerator / denominator;
    }

    function swap(address tokenIn, uint256 amountIn, address to) external returns (uint256 amountOut) {
        require(to != address(0), 'ZERO_TO');
        require(tokenIn == token0 || tokenIn == token1, 'INVALID_TOKEN_IN');
        require(amountIn > 0, 'INSUFFICIENT_INPUT');

        bool zeroForOne = tokenIn == token0;
        address tokenOut = zeroForOne ? token1 : token0;

        // 输入 token 应该已经由 router 或上一跳 pair 发送到当前 pair
        amountOut = getAmountOut(tokenIn, amountIn);

        IERC20(tokenOut).transfer(to, amountOut);

        uint256 newBal0 = IERC20(token0).balanceOf(address(this));
        uint256 newBal1 = IERC20(token1).balanceOf(address(this));

        reserve0 = uint112(newBal0);
        reserve1 = uint112(newBal1);
    }

     function syncReserves(uint112 newReserve0, uint112 newReserve1) external {
        reserve0 = newReserve0;
        reserve1 = newReserve1;
    }
}