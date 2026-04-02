/**
 * FLASHLOAN-AI: Multicall3 Module
 * Batch nhieu RPC calls thanh 1 de tiet kiem thoi gian va gas
 * Su dung Multicall3 contract (available tren hau het EVM chains)
 */

const { ethers } = require("ethers");

// Multicall3 address (same on all chains)
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
  "function aggregate3Value(tuple(address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[])",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
];

class MulticallProvider {
  constructor(provider) {
    this.provider = provider;
    this.multicall = new ethers.Contract(
      MULTICALL3_ADDRESS,
      MULTICALL3_ABI,
      provider
    );
  }

  /**
   * Goi nhieu function cung luc qua Multicall3
   * @param {Array} calls - Mang cac call: { target, abi, functionName, args }
   * @param {boolean} allowFailure - Cho phep 1 so call fail ma khong revert tat ca
   * @returns {Array} Ket qua cua tung call
   */
  async callMultiple(calls, allowFailure = true) {
    const encodedCalls = calls.map((call) => {
      const iface = new ethers.Interface(
        Array.isArray(call.abi) ? call.abi : [call.abi]
      );
      const callData = iface.encodeFunctionData(call.functionName, call.args || []);

      return {
        target: call.target,
        allowFailure,
        callData,
      };
    });

    const results = await this.multicall.aggregate3.staticCall(encodedCalls);

    return results.map((result, i) => {
      if (!result.success) {
        return { success: false, data: null, error: "Call failed" };
      }

      try {
        const iface = new ethers.Interface(
          Array.isArray(calls[i].abi) ? calls[i].abi : [calls[i].abi]
        );
        const decoded = iface.decodeFunctionResult(
          calls[i].functionName,
          result.returnData
        );
        return {
          success: true,
          data: decoded.length === 1 ? decoded[0] : decoded,
        };
      } catch (error) {
        return { success: false, data: null, error: error.message };
      }
    });
  }

  /**
   * Lay balance cua nhieu token cho 1 address
   */
  async getTokenBalances(walletAddress, tokenAddresses) {
    const erc20Abi = ["function balanceOf(address) view returns (uint256)"];

    const calls = tokenAddresses.map((token) => ({
      target: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    }));

    const results = await this.callMultiple(calls);

    return tokenAddresses.reduce((balances, token, i) => {
      balances[token] = results[i].success ? results[i].data : 0n;
      return balances;
    }, {});
  }

  /**
   * Lay gia tu nhieu V2 router cung luc
   */
  async getV2Prices(routerPriceQueries) {
    const routerAbi = [
      "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
    ];

    const calls = routerPriceQueries.map((q) => ({
      target: q.router,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [q.amountIn, q.path],
    }));

    const results = await this.callMultiple(calls);

    return results.map((result, i) => ({
      router: routerPriceQueries[i].router,
      path: routerPriceQueries[i].path,
      success: result.success,
      amountOut: result.success
        ? result.data[result.data.length - 1]
        : 0n,
    }));
  }

  /**
   * Lay ETH balance cua nhieu address cung luc
   */
  async getEthBalances(addresses) {
    const calls = addresses.map((addr) => ({
      target: MULTICALL3_ADDRESS,
      abi: MULTICALL3_ABI,
      functionName: "getEthBalance",
      args: [addr],
    }));

    const results = await this.callMultiple(calls);

    return addresses.reduce((balances, addr, i) => {
      balances[addr] = results[i].success ? results[i].data : 0n;
      return balances;
    }, {});
  }

  /**
   * Lay block number va timestamp hien tai
   */
  async getBlockInfo() {
    const calls = [
      {
        target: MULTICALL3_ADDRESS,
        abi: MULTICALL3_ABI,
        functionName: "getBlockNumber",
        args: [],
      },
      {
        target: MULTICALL3_ADDRESS,
        abi: MULTICALL3_ABI,
        functionName: "getCurrentBlockTimestamp",
        args: [],
      },
    ];

    const results = await this.callMultiple(calls);

    return {
      blockNumber: results[0].success ? Number(results[0].data) : 0,
      timestamp: results[1].success ? Number(results[1].data) : 0,
    };
  }
}

module.exports = { MulticallProvider, MULTICALL3_ADDRESS };
