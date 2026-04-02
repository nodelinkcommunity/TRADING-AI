/**
 * FLASHLOAN-AI: Deploy Script
 * Deploy smart contract len blockchain
 *
 * Su dung:
 *   npx hardhat run scripts/deploy.js --network arbitrumSepolia
 *   npx hardhat run scripts/deploy.js --network arbitrum
 */

const hre = require("hardhat");

// Aave V3 Pool Address Provider cho tung chain
const AAVE_PROVIDERS = {
  421614: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Arbitrum Sepolia
  42161: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Arbitrum Mainnet
  8453: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D", // Base
  84532: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D", // Base Sepolia
  137: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Polygon
  1: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e", // Ethereum
};

// DEX Routers cho tung chain
const DEX_ROUTERS = {
  42161: {
    uniswapV3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    sushiswap: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    camelot: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
  },
  8453: {
    uniswapV3: "0x2626664c2603336E57B271c5C0b26F421741e481",
    aerodrome: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  },
  137: {
    uniswapV3: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    sushiswap: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    quickswap: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
  },
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("\n====================================");
  console.log("  FLASHLOAN-AI Contract Deployment");
  console.log("====================================\n");
  console.log(`Network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // Lay Aave provider
  const aaveProvider = AAVE_PROVIDERS[chainId];
  if (!aaveProvider) {
    throw new Error(`Aave provider not configured for chainId ${chainId}`);
  }
  console.log(`Aave Provider: ${aaveProvider}`);

  // Deploy contract
  console.log("\nDeploying FlashloanArbitrage...");
  const FlashloanArbitrage = await hre.ethers.getContractFactory(
    "FlashloanArbitrage"
  );
  const contract = await FlashloanArbitrage.deploy(aaveProvider);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`Contract deployed: ${contractAddress}`);

  // Set DEX routers
  const routers = DEX_ROUTERS[chainId];
  if (routers) {
    console.log("\nSetting DEX routers...");
    for (const [name, address] of Object.entries(routers)) {
      const tx = await contract.setDexRouter(name, address);
      await tx.wait();
      console.log(`  ${name}: ${address}`);
    }
  }

  // In thong tin deployment
  console.log("\n====================================");
  console.log("  Deployment Complete!");
  console.log("====================================");
  console.log(`Contract: ${contractAddress}`);
  console.log(`Owner: ${deployer.address}`);
  console.log(`Chain: ${chainId}`);
  console.log("\nNext steps:");
  console.log("1. Update config.json with contract address");
  console.log("2. Fund contract if needed");
  console.log("3. Start the monitoring bot");
  console.log("====================================\n");

  // Verify contract (optional)
  if (chainId !== 31337 && chainId !== 421614 && chainId !== 84532) {
    console.log("Verifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [aaveProvider],
      });
      console.log("Contract verified!");
    } catch (error) {
      console.log(`Verification failed: ${error.message}`);
      console.log("You can verify manually later.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
