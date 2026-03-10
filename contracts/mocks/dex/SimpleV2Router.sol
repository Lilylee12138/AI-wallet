// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './SimpleV2Factory.sol';
import './SimpleV2Pair.sol';


interface IWETHLike {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

contract SimpleV2Router {
    address public immutable factory;
    address public immutable WETH;

    constructor(address _factory, address _weth) {
        require(_factory != address(0), 'ZERO_FACTORY');
        require(_weth != address(0), 'ZERO_WETH');
        factory = _factory;
        WETH = _weth;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external returns (address pair) {
        pair = SimpleV2Factory(factory).getPair(tokenA, tokenB);

        if (pair == address(0)) {
            pair = SimpleV2Factory(factory).createPair(tokenA, tokenB);
        }

        IERC20(tokenA).transferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).transferFrom(msg.sender, pair, amountB);

        (uint112 reserve0, uint112 reserve1) = SimpleV2Pair(pair).getReserves();
        address token0 = SimpleV2Pair(pair).token0();

        uint112 newReserve0 = reserve0;
        uint112 newReserve1 = reserve1;

        if (tokenA == token0) {
            newReserve0 += uint112(amountA);
            newReserve1 += uint112(amountB);
        } else {
            newReserve0 += uint112(amountB);
            newReserve1 += uint112(amountA);
        }

        _sync(pair, newReserve0, newReserve1);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256 amountOut) {
        require(amountIn > 0, 'INSUFFICIENT_INPUT');
        require(reserveIn > 0 && reserveOut > 0, 'INSUFFICIENT_LIQUIDITY');

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts) {
        return _getAmountsOutInternal(amountIn, path);
    }

    function _getAmountsOutInternal(uint256 amountIn, address[] memory path) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, 'INVALID_PATH');

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = SimpleV2Factory(factory).getPair(path[i], path[i + 1]);
            require(pair != address(0), 'PAIR_NOT_FOUND');

            (uint112 reserve0, uint112 reserve1) = SimpleV2Pair(pair).getReserves();
            address token0 = SimpleV2Pair(pair).token0();

            uint256 reserveIn;
            uint256 reserveOut;

            if (path[i] == token0) {
                reserveIn = reserve0;
                reserveOut = reserve1;
            } else {
                reserveIn = reserve1;
                reserveOut = reserve0;
            }

            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) external returns (uint256[] memory amounts) {
        require(path.length >= 2, 'INVALID_PATH');
        require(to != address(0), 'ZERO_TO');

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = SimpleV2Factory(factory).getPair(path[i], path[i + 1]);
            require(pair != address(0), 'PAIR_NOT_FOUND');

            (uint112 reserve0, uint112 reserve1) = SimpleV2Pair(pair).getReserves();
            address token0 = SimpleV2Pair(pair).token0();

            uint256 reserveIn;
            uint256 reserveOut;
            bool zeroForOne = path[i] == token0;

            if (zeroForOne) {
                reserveIn = reserve0;
                reserveOut = reserve1;
            } else {
                reserveIn = reserve1;
                reserveOut = reserve0;
            }

            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);

            address recipient;
            if (i < path.length - 2) {
                recipient = SimpleV2Factory(factory).getPair(path[i + 1], path[i + 2]);
            } else {
                recipient = to;
            }

            if (i == 0) {
                IERC20(path[i]).transferFrom(msg.sender, pair, amounts[i]);
            }

            _swap(pair, path[i], amounts[i], recipient);
        }

        require(amounts[amounts.length - 1] >= amountOutMin, 'INSUFFICIENT_OUTPUT');
    }

    function _swap(address pair, address tokenIn, uint256 amountIn, address to) internal {
        SimpleV2Pair(pair).swap(tokenIn, amountIn, to);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, 'EXPIRED');
        require(path.length >= 2, 'INVALID_PATH');
        require(to != address(0), 'ZERO_TO');
        require(path[0] == WETH, 'PATH_MUST_START_WITH_WETH');
        require(msg.value > 0, 'NO_ETH_SENT');

        // 1) wrap ETH -> WETH, WETH 会先存到 router 自己这里
        IWETHLike(WETH).deposit{value: msg.value}();

        // 2) 先算整条 path 的输出
        address[] memory mpath = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) {
            mpath[i] = path[i];
        }

        amounts = _getAmountsOutInternal(msg.value, mpath);
        require(amounts[amounts.length - 1] >= amountOutMin, 'INSUFFICIENT_OUTPUT');

        // 3) 把第一跳输入 token(WETH) 先打到第一跳 pair
        address firstPair = SimpleV2Factory(factory).getPair(path[0], path[1]);
        require(firstPair != address(0), 'PAIR_NOT_FOUND');
        require(IWETHLike(WETH).transfer(firstPair, amounts[0]), 'WETH_TRANSFER_FAILED');

        // 4) 按现有多跳方式继续 swap
        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = SimpleV2Factory(factory).getPair(path[i], path[i + 1]);
            require(pair != address(0), 'PAIR_NOT_FOUND');

            address recipient;
            if (i < path.length - 2) {
                recipient = SimpleV2Factory(factory).getPair(path[i + 1], path[i + 2]);
            } else {
                recipient = to;
            }

            _swap(pair, path[i], amounts[i], recipient);
        }
    }


    function _sync(address pair, uint112 newReserve0, uint112 newReserve1) internal {
        bytes memory data = abi.encodeWithSignature(
            'syncReserves(uint112,uint112)',
            newReserve0,
            newReserve1
        );

        (bool ok, ) = pair.call(data);
        require(ok, 'SYNC_FAILED');
    }
}