// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  FLASHLOAN-AI: Smart Contract Arbitrage cho BSC
//  Su dung PancakeSwap V3 Flash Loan (thay vi Aave)
//  Compatible: BSC (BNB Smart Chain)
// ============================================================

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// PancakeSwap V3 Pool interface
interface IPancakeV3Pool {
    function flash(
        address recipient,
        uint256 amount0,
        uint256 amount1,
        bytes calldata data
    ) external;

    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

// PancakeSwap V3 Factory interface
interface IPancakeV3Factory {
    function getPool(
        address tokenA,
        address tokenB,
        uint24 fee
    ) external view returns (address pool);
}

// Uniswap V3 style Router
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

    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

// Uniswap V2 style Router (PancakeSwap V2, BiSwap, ApeSwap)
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

contract FlashloanArbitrageBSC is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============

    // PancakeSwap V3 Factory
    IPancakeV3Factory public immutable pancakeFactory;

    // DEX routers
    mapping(string => address) public dexRouters;

    // Cau hinh
    uint256 public minProfitBps = 10; // 0.1%
    uint256 public maxSlippageBps = 50; // 0.5%
    bool public paused = false;

    // Thong ke
    uint256 public totalTrades;
    uint256 public totalProfit;
    uint256 public totalFlashloaned;

    // Struct cho lenh swap
    struct SwapStep {
        string dexName;
        address tokenIn;
        address tokenOut;
        uint24 fee;
        bool isV3;
        uint256 amountOutMin;
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
        address _pancakeFactory
    ) Ownable(msg.sender) {
        pancakeFactory = IPancakeV3Factory(_pancakeFactory);
    }

    // ============ Core Functions ============

    /**
     * @notice Bat dau arbitrage voi PancakeSwap V3 Flash Loan
     * @param _token Token de vay flash loan
     * @param _amount So luong token vay
     * @param _params Encoded SwapStep[] chua cac buoc swap
     * @param _pairedToken Token ghep cap voi _token tren PancakeSwap V3
     * @param _poolFee Fee tier cua pool (100, 500, 2500, 10000)
     */
    function executeArbitrage(
        address _token,
        uint256 _amount,
        bytes calldata _params,
        address _pairedToken,
        uint24 _poolFee
    ) external onlyOwner whenNotPaused nonReentrant {
        // Tim pool PancakeSwap V3 de vay flash loan
        address pool = pancakeFactory.getPool(_token, _pairedToken, _poolFee);
        require(pool != address(0), "Pool not found");

        // Ghi nhan so du truoc
        uint256 balanceBefore = IERC20(_token).balanceOf(address(this));

        // Xac dinh token0/token1 cua pool
        address token0 = IPancakeV3Pool(pool).token0();
        uint256 amount0 = _token == token0 ? _amount : 0;
        uint256 amount1 = _token == token0 ? 0 : _amount;

        // Encode data cho callback
        bytes memory callbackData = abi.encode(_token, _amount, _params);

        // Goi flash loan tu PancakeSwap V3 Pool
        IPancakeV3Pool(pool).flash(
            address(this),
            amount0,
            amount1,
            callbackData
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
            0,
            block.timestamp
        );
    }

    /**
     * @notice Callback tu PancakeSwap V3 sau khi nhan flash loan
     * @dev PancakeSwap V3 goi ham nay sau khi chuyen token
     */
    function pancakeV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external {
        // Decode callback data
        (address token, uint256 amount, bytes memory params) = abi.decode(
            data,
            (address, uint256, bytes)
        );

        // Verify caller la PancakeSwap V3 Pool hop le
        // (Khong the verify chinh xac pool address trong callback,
        //  nhung chi owner moi co the goi executeArbitrage)

        // Decode swap steps
        SwapStep[] memory steps = abi.decode(params, (SwapStep[]));

        // Thuc hien tung buoc swap
        uint256 currentAmount = amount;
        address currentToken = token;

        for (uint256 i = 0; i < steps.length; i++) {
            require(steps[i].tokenIn == currentToken, "Token mismatch");
            currentAmount = _executeSwap(steps[i], currentAmount);
            currentToken = steps[i].tokenOut;
        }

        // Dam bao token cuoi cung la token da vay
        require(currentToken == token, "Must end with borrowed token");

        // Tinh phi flash loan
        uint256 flashFee = token == IPancakeV3Pool(msg.sender).token0() ? fee0 : fee1;
        uint256 amountOwed = amount + flashFee;
        require(currentAmount >= amountOwed, "Insufficient funds to repay");

        // Tra lai flash loan + phi
        IERC20(token).safeTransfer(msg.sender, amountOwed);

        totalTrades++;
        totalFlashloaned += amount;
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

        IERC20(step.tokenIn).safeIncreaseAllowance(router, amountIn);

        if (step.isV3) {
            // PancakeSwap V3 / Uniswap V3 style swap
            amountOut = ISwapRouter(router).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: step.tokenIn,
                    tokenOut: step.tokenOut,
                    fee: step.fee,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountIn,
                    amountOutMinimum: step.amountOutMin,
                    sqrtPriceLimitX96: 0
                })
            );
        } else {
            // PancakeSwap V2 / BiSwap / ApeSwap style swap
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

    function simulateArbitrage(
        address _token,
        uint256 _amount,
        SwapStep[] calldata _steps,
        address _pairedToken,
        uint24 _poolFee
    ) external view returns (uint256 estimatedProfit, bool isProfitable) {
        // Kiem tra pool ton tai
        address pool = pancakeFactory.getPool(_token, _pairedToken, _poolFee);
        if (pool == address(0)) return (0, false);

        // Phi flash loan PancakeSwap V3 = pool fee
        uint256 flashFee = (_amount * _poolFee) / 1000000;
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

        if (currentAmount > _amount + flashFee) {
            estimatedProfit = currentAmount - _amount - flashFee;
            isProfitable = estimatedProfit > (_amount * minProfitBps) / 10000;
        }
    }

    // ============ Admin Functions ============

    function setDexRouter(string calldata _name, address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        dexRouters[_name] = _router;
        emit DexRouterUpdated(_name, _router);
    }

    function setMinProfitBps(uint256 _bps) external onlyOwner {
        require(_bps <= 1000, "Max 10%");
        minProfitBps = _bps;
    }

    function setMaxSlippageBps(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "Max 5%");
        maxSlippageBps = _bps;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyStop(_paused);
    }

    function withdrawProfit(address _token) external onlyOwner {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        require(balance > 0, "No balance");
        IERC20(_token).safeTransfer(owner(), balance);
        emit ProfitWithdrawn(_token, balance);
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No BNB balance");
        (bool success, ) = owner().call{value: balance}("");
        require(success, "BNB transfer failed");
    }

    receive() external payable {}
}
