/**
 * FLASHLOAN-AI: Unit Tests
 * Test FlashloanArbitrage va LiquidationExecutor contracts
 *
 * Chay: npx hardhat test
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashloanArbitrage", function () {
  let contract;
  let owner, user1;
  let mockProvider;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    // Deploy mock Aave PoolAddressesProvider
    const MockProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
    mockProvider = await MockProvider.deploy();
    await mockProvider.waitForDeployment();

    const FlashloanArbitrage = await ethers.getContractFactory("FlashloanArbitrage");
    contract = await FlashloanArbitrage.deploy(await mockProvider.getAddress());
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should initialize with correct default values", async function () {
      expect(await contract.minProfitBps()).to.equal(10);
      expect(await contract.maxSlippageBps()).to.equal(50);
      expect(await contract.paused()).to.equal(false);
      expect(await contract.totalTrades()).to.equal(0);
      expect(await contract.totalProfit()).to.equal(0);
      expect(await contract.totalFlashloaned()).to.equal(0);
    });
  });

  describe("Admin Functions", function () {
    it("should allow owner to set DEX router", async function () {
      const routerAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
      await expect(contract.setDexRouter("uniswapV3", routerAddress))
        .to.emit(contract, "DexRouterUpdated")
        .withArgs("uniswapV3", routerAddress);

      expect(await contract.dexRouters("uniswapV3")).to.equal(routerAddress);
    });

    it("should reject setting zero address as router", async function () {
      await expect(
        contract.setDexRouter("uniswapV3", ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid router");
    });

    it("should allow owner to set minProfitBps", async function () {
      await contract.setMinProfitBps(50);
      expect(await contract.minProfitBps()).to.equal(50);
    });

    it("should reject minProfitBps over 1000", async function () {
      await expect(contract.setMinProfitBps(1001)).to.be.revertedWith("Max 10%");
    });

    it("should allow owner to set maxSlippageBps", async function () {
      await contract.setMaxSlippageBps(100);
      expect(await contract.maxSlippageBps()).to.equal(100);
    });

    it("should reject maxSlippageBps over 500", async function () {
      await expect(contract.setMaxSlippageBps(501)).to.be.revertedWith("Max 5%");
    });

    it("should allow owner to pause and unpause", async function () {
      await expect(contract.setPaused(true))
        .to.emit(contract, "EmergencyStop")
        .withArgs(true);

      expect(await contract.paused()).to.equal(true);

      await contract.setPaused(false);
      expect(await contract.paused()).to.equal(false);
    });

    it("should reject non-owner calling admin functions", async function () {
      await expect(
        contract.connect(user1).setDexRouter("test", user1.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");

      await expect(
        contract.connect(user1).setMinProfitBps(100)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");

      await expect(
        contract.connect(user1).setPaused(true)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause mechanism", function () {
    it("should block executeArbitrage when paused", async function () {
      await contract.setPaused(true);

      await expect(
        contract.executeArbitrage(
          ethers.ZeroAddress,
          ethers.parseEther("1"),
          "0x"
        )
      ).to.be.revertedWith("Contract is paused");
    });
  });

  describe("Withdraw", function () {
    it("should revert withdrawProfit when no balance", async function () {
      // Use a random non-zero address as token
      const fakeToken = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
      await expect(contract.withdrawProfit(fakeToken)).to.be.reverted;
    });

    it("should revert withdrawETH when no ETH balance", async function () {
      await expect(contract.withdrawETH()).to.be.revertedWith("No ETH balance");
    });

    it("should receive ETH", async function () {
      await owner.sendTransaction({
        to: await contract.getAddress(),
        value: ethers.parseEther("1.0"),
      });

      const contractBalance = await ethers.provider.getBalance(
        await contract.getAddress()
      );
      expect(contractBalance).to.equal(ethers.parseEther("1.0"));
    });

    it("should allow owner to withdraw ETH", async function () {
      const contractAddr = await contract.getAddress();

      await owner.sendTransaction({
        to: contractAddr,
        value: ethers.parseEther("1.0"),
      });

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await contract.withdrawETH();
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(owner.address);

      expect(balanceAfter + gasCost - balanceBefore).to.equal(
        ethers.parseEther("1.0")
      );
    });
  });
});

describe("LiquidationExecutor", function () {
  let contract;
  let owner, user1;
  let mockProvider;

  beforeEach(async function () {
    [owner, user1] = await ethers.getSigners();

    const MockProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
    mockProvider = await MockProvider.deploy();
    await mockProvider.waitForDeployment();

    const LiquidationExecutor = await ethers.getContractFactory("LiquidationExecutor");
    contract = await LiquidationExecutor.deploy(await mockProvider.getAddress());
    await contract.waitForDeployment();
  });

  describe("Deployment", function () {
    it("should set the correct owner", async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should initialize with zero stats", async function () {
      expect(await contract.totalLiquidations()).to.equal(0);
      expect(await contract.totalProfitUSD()).to.equal(0);
    });
  });

  describe("Router Management", function () {
    it("should set V2 router", async function () {
      const router = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
      await expect(contract.setSwapRouterV2(router))
        .to.emit(contract, "RouterUpdated")
        .withArgs("v2", router);

      expect(await contract.swapRouterV2()).to.equal(router);
    });

    it("should set V3 router", async function () {
      const router = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
      await expect(contract.setSwapRouterV3(router))
        .to.emit(contract, "RouterUpdated")
        .withArgs("v3", router);

      expect(await contract.swapRouterV3()).to.equal(router);
    });

    it("should reject zero address for routers", async function () {
      await expect(
        contract.setSwapRouterV2(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid router");

      await expect(
        contract.setSwapRouterV3(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid router");
    });

    it("should reject non-owner setting routers", async function () {
      await expect(
        contract.connect(user1).setSwapRouterV2(user1.address)
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  describe("Withdraw", function () {
    it("should receive and withdraw ETH", async function () {
      const contractAddr = await contract.getAddress();

      await owner.sendTransaction({
        to: contractAddr,
        value: ethers.parseEther("0.5"),
      });

      const contractBalance = await ethers.provider.getBalance(contractAddr);
      expect(contractBalance).to.equal(ethers.parseEther("0.5"));

      await contract.withdrawETH();
      const afterBalance = await ethers.provider.getBalance(contractAddr);
      expect(afterBalance).to.equal(0);
    });
  });
});
