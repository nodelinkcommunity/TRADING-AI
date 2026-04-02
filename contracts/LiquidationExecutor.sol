// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  FLASHLOAN-AI: Liquidation Executor
//  Flashloan -> Liquidation -> Swap collateral -> Tra no -> Giu loi nhuan
//  Compatible: Arbitrum, Base, Polygon
// ============================================================

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/ISwapRouter.sol";

contract LiquidationExecutor is FlashLoanSimpleReceiverBase, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    // DEX router cho swap collateral -> debt token
    address public swapRouterV2;
    address public swapRouterV3;

    // Thong ke
    uint256 public totalLiquidations;
    uint256 public totalProfitUSD;

    // ============ Structs ============

    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address user;
        uint256 debtToCover;
        bool useV3;          // true = Uniswap V3, false = V2
        uint24 swapFee;      // Fee tier cho V3 (500, 3000, 10000)
    }

    // ============ Events ============

    event LiquidationExecuted(
        address indexed user,
        address indexed collateralAsset,
        address indexed debtAsset,
        uint256 debtCovered,
        uint256 collateralReceived,
        uint256 profit,
        uint256 timestamp
    );

    event RouterUpdated(string routerType, address router);

    // ============ Constructor ============

    constructor(
        address _addressProvider
    ) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
      Ownable(msg.sender) {}

    // ============ Core Functions ============

    /**
     * @notice Bat dau thanh ly voi flashloan
     * @param _params Encoded LiquidationParams
     */
    function executeLiquidation(
        address _debtAsset,
        uint256 _debtAmount,
        bytes calldata _params
    ) external onlyOwner nonReentrant {
        uint256 balanceBefore = IERC20(_debtAsset).balanceOf(address(this));

        POOL.flashLoanSimple(
            address(this),
            _debtAsset,
            _debtAmount,
            _params,
            0
        );

        uint256 balanceAfter = IERC20(_debtAsset).balanceOf(address(this));
        require(balanceAfter >= balanceBefore, "Liquidation not profitable");

        uint256 profit = balanceAfter - balanceBefore;
        totalProfitUSD += profit;

        emit LiquidationExecuted(
            address(0), // user decoded from params
            address(0), // collateral decoded from params
            _debtAsset,
            _debtAmount,
            0,
            profit,
            block.timestamp
        );
    }

    /**
     * @notice Callback tu Aave sau khi nhan flashloan
     * Flow: Nhan debt token -> Liquidate tren Aave -> Nhan collateral + bonus -> Swap collateral -> debt token -> Tra no
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller must be POOL");
        require(initiator == address(this), "Initiator must be this contract");

        // Decode params
        LiquidationParams memory liqParams = abi.decode(params, (LiquidationParams));

        // Buoc 1: Approve debt token cho Aave Pool
        IERC20(asset).safeIncreaseAllowance(address(POOL), amount);

        // Buoc 2: Goi liquidationCall tren Aave
        // Nhan collateral + liquidation bonus (5-10%)
        POOL.liquidationCall(
            liqParams.collateralAsset,
            liqParams.debtAsset,
            liqParams.user,
            liqParams.debtToCover,
            false // receiveAToken = false, nhan underlying token
        );

        // Buoc 3: Swap collateral nhan duoc -> debt token
        uint256 collateralBalance = IERC20(liqParams.collateralAsset).balanceOf(address(this));
        require(collateralBalance > 0, "No collateral received");

        uint256 debtReceived;
        if (liqParams.collateralAsset != asset) {
            debtReceived = _swapCollateralForDebt(
                liqParams.collateralAsset,
                asset,
                collateralBalance,
                liqParams.useV3,
                liqParams.swapFee
            );
        } else {
            debtReceived = collateralBalance;
        }

        // Buoc 4: Tra flashloan + premium
        uint256 amountOwed = amount + premium;
        require(debtReceived + IERC20(asset).balanceOf(address(this)) >= amountOwed,
            "Insufficient to repay flashloan");

        IERC20(asset).safeIncreaseAllowance(address(POOL), amountOwed);

        totalLiquidations++;

        return true;
    }

    /**
     * @notice Swap collateral token -> debt token qua DEX
     */
    function _swapCollateralForDebt(
        address _collateral,
        address _debt,
        uint256 _amount,
        bool _useV3,
        uint24 _fee
    ) internal returns (uint256 amountOut) {
        if (_useV3 && swapRouterV3 != address(0)) {
            IERC20(_collateral).safeIncreaseAllowance(swapRouterV3, _amount);

            amountOut = ISwapRouter(swapRouterV3).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: _collateral,
                    tokenOut: _debt,
                    fee: _fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: _amount,
                    amountOutMinimum: 0, // Slippage handled off-chain
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            require(swapRouterV2 != address(0), "V2 router not set");
            IERC20(_collateral).safeIncreaseAllowance(swapRouterV2, _amount);

            address[] memory path = new address[](2);
            path[0] = _collateral;
            path[1] = _debt;

            uint256[] memory amounts = IUniswapV2Router02(swapRouterV2)
                .swapExactTokensForTokens(
                    _amount,
                    0,
                    path,
                    address(this),
                    block.timestamp + 300
                );

            amountOut = amounts[amounts.length - 1];
        }
    }

    // ============ Admin Functions ============

    function setSwapRouterV2(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        swapRouterV2 = _router;
        emit RouterUpdated("v2", _router);
    }

    function setSwapRouterV3(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        swapRouterV3 = _router;
        emit RouterUpdated("v3", _router);
    }

    function withdrawProfit(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(_token).safeTransfer(owner(), balance);
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    receive() external payable {}
}
