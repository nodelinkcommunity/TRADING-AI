// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  FLASHLOAN-AI: Smart Contract Arbitrage voi Aave V3
//  Ho tro: DEX-to-DEX, Triangular, Multi-hop arbitrage
//  Compatible: Arbitrum, Base, Polygon, Ethereum, BSC
// ============================================================

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Interface cho Uniswap V3 Router
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);

    function exactInput(ExactInputParams calldata params)
        external payable returns (uint256 amountOut);
}

// Interface cho Uniswap V2 Router (SushiSwap, PancakeSwap tuong thich)
interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external view returns (uint256[] memory amounts);
}

contract FlashloanArbitrage is FlashLoanSimpleReceiverBase, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    // Cac DEX router
    mapping(string => address) public dexRouters;

    // Cau hinh
    uint256 public minProfitBps = 10; // 0.1% loi nhuan toi thieu
    uint256 public maxSlippageBps = 50; // 0.5% slippage toi da
    bool public paused = false;

    // Thong ke
    uint256 public totalTrades;
    uint256 public totalProfit;
    uint256 public totalFlashloaned;

    // Struct cho lenh swap
    struct SwapStep {
        string dexName;      // Ten DEX (vd: "uniswapV3", "sushiswap")
        address tokenIn;     // Token dau vao
        address tokenOut;    // Token dau ra
        uint24 fee;          // Fee tier (cho Uniswap V3: 500, 3000, 10000)
        bool isV3;           // true = V3 router, false = V2 router
        uint256 amountOutMin; // So luong toi thieu nhan duoc
    }

    // Struct cho params truyen vao flashloan
    struct ArbitrageParams {
        SwapStep[] steps;
        uint256 expectedProfit;
    }

    // ============ Events ============

    event ArbitrageExecuted(
        address indexed token,
        uint256 flashAmount,
        uint256 profit,
        uint256 gasUsed,
        uint256 timestamp
    );

    event DexRouterUpdated(string dexName, address router);
    event ProfitWithdrawn(address token, uint256 amount);
    event EmergencyStop(bool paused);

    // ============ Modifiers ============

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    // ============ Constructor ============

    constructor(
        address _addressProvider
    ) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
      Ownable(msg.sender) {
        // Cac router se duoc set sau khi deploy
    }

    // ============ Core Functions ============

    /**
     * @notice Bat dau giao dich arbitrage voi flashloan
     * @param _token Token de vay flashloan
     * @param _amount So luong token vay
     * @param _params Encoded ArbitrageParams chua cac buoc swap
     */
    function executeArbitrage(
        address _token,
        uint256 _amount,
        bytes calldata _params
    ) external onlyOwner whenNotPaused nonReentrant {
        // Ghi nhan so du truoc
        uint256 balanceBefore = IERC20(_token).balanceOf(address(this));

        // Goi flashloan tu Aave V3
        POOL.flashLoanSimple(
            address(this),  // receiver
            _token,         // asset
            _amount,        // amount
            _params,        // params (se duoc truyen vao executeOperation)
            0               // referral code
        );

        // Kiem tra loi nhuan
        uint256 balanceAfter = IERC20(_token).balanceOf(address(this));
        require(balanceAfter > balanceBefore, "No profit made");

        uint256 profit = balanceAfter - balanceBefore;
        totalProfit += profit;

        emit ArbitrageExecuted(
            _token,
            _amount,
            profit,
            0, // gas se duoc track off-chain
            block.timestamp
        );
    }

    /**
     * @notice Callback tu Aave sau khi nhan flashloan
     * @dev Day la noi thuc hien cac buoc swap
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
        SwapStep[] memory steps = abi.decode(params, (SwapStep[]));

        // Thuc hien tung buoc swap
        uint256 currentAmount = amount;
        address currentToken = asset;

        for (uint256 i = 0; i < steps.length; i++) {
            require(steps[i].tokenIn == currentToken, "Token mismatch");

            currentAmount = _executeSwap(
                steps[i],
                currentAmount
            );
            currentToken = steps[i].tokenOut;
        }

        // Dam bao token cuoi cung la token da vay
        require(currentToken == asset, "Must end with borrowed token");

        // Tra lai flashloan + premium
        uint256 amountOwed = amount + premium;
        require(currentAmount >= amountOwed, "Insufficient funds to repay");

        // Approve cho Aave Pool de tra no
        IERC20(asset).safeIncreaseAllowance(address(POOL), amountOwed);

        totalTrades++;
        totalFlashloaned += amount;

        return true;
    }

    /**
     * @notice Thuc hien 1 buoc swap tren DEX
     */
    function _executeSwap(
        SwapStep memory step,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        address router = dexRouters[step.dexName];
        require(router != address(0), "DEX router not set");

        // Approve token cho router
        IERC20(step.tokenIn).safeIncreaseAllowance(router, amountIn);

        if (step.isV3) {
            // Uniswap V3 style swap
            amountOut = ISwapRouter(router).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: step.tokenIn,
                    tokenOut: step.tokenOut,
                    fee: step.fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300, // 5 phut
                    amountIn: amountIn,
                    amountOutMinimum: step.amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            // Uniswap V2 style swap (SushiSwap, PancakeSwap, v.v.)
            address[] memory path = new address[](2);
            path[0] = step.tokenIn;
            path[1] = step.tokenOut;

            uint256[] memory amounts = IUniswapV2Router02(router)
                .swapExactTokensForTokens(
                    amountIn,
                    step.amountOutMin,
                    path,
                    address(this),
                    block.timestamp + 300
                );

            amountOut = amounts[amounts.length - 1];
        }

        require(amountOut > 0, "Swap returned 0");
    }

    // ============ View Functions ============

    /**
     * @notice Mo phong giao dich de kiem tra loi nhuan (off-chain)
     * @dev Goi staticcall den ham nay de kiem tra truoc khi thuc hien
     */
    function simulateArbitrage(
        address _token,
        uint256 _amount,
        SwapStep[] calldata _steps
    ) external view returns (uint256 estimatedProfit, bool isProfitable) {
        uint256 flashloanFee = (_amount * 5) / 10000; // 0.05% Aave fee
        uint256 totalCost = flashloanFee;

        // Uoc tinh output qua cac buoc (chi V2, V3 can off-chain quote)
        uint256 currentAmount = _amount;

        for (uint256 i = 0; i < _steps.length; i++) {
            if (!_steps[i].isV3) {
                address router = dexRouters[_steps[i].dexName];
                if (router != address(0)) {
                    address[] memory path = new address[](2);
                    path[0] = _steps[i].tokenIn;
                    path[1] = _steps[i].tokenOut;

                    try IUniswapV2Router02(router).getAmountsOut(currentAmount, path)
                        returns (uint256[] memory amounts)
                    {
                        currentAmount = amounts[amounts.length - 1];
                    } catch {
                        return (0, false);
                    }
                }
            }
        }

        if (currentAmount > _amount + totalCost) {
            estimatedProfit = currentAmount - _amount - totalCost;
            isProfitable = estimatedProfit > (_amount * minProfitBps) / 10000;
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Them/Cap nhat DEX router
     */
    function setDexRouter(string calldata _name, address _router)
        external onlyOwner
    {
        require(_router != address(0), "Invalid router");
        dexRouters[_name] = _router;
        emit DexRouterUpdated(_name, _router);
    }

    /**
     * @notice Dat muc loi nhuan toi thieu (basis points)
     */
    function setMinProfitBps(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "Max 10%");
        minProfitBps = _bps;
    }

    /**
     * @notice Dat muc slippage toi da (basis points)
     */
    function setMaxSlippageBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "Max 5%");
        maxSlippageBps = _bps;
    }

    /**
     * @notice Tam dung / Tiep tuc contract
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyStop(_paused);
    }

    /**
     * @notice Rut loi nhuan
     */
    function withdrawProfit(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(_token).safeTransfer(owner(), balance);
        emit ProfitWithdrawn(_token, balance);
    }

    /**
     * @notice Rut ETH (neu co)
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH balance");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    // Nhan ETH
    receive() external payable {}
}
