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
  421614: "0xB25a5D144626a0D488e52AE717A051a2E9997076", // Arbitrum Sepolia (testnet)
  42161: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Arbitrum Mainnet
  8453: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D", // Base
  84532: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00", // Base Sepolia (testnet)
  137: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Polygon
  1: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e", // Ethereum
  43114: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb", // Avalanche
  534352: "0x69850D0B276776781C063771b161bd8894BCdD04", // Scroll
  5000: "0x10f7Bb5e3C4c77a57e2Ec4c348AeB661E65b8F8b", // Mantle (Lendle - Aave V3 fork)
};

// PancakeSwap V3 Factory cho BSC (dung cho flash loan thay Aave)
const PANCAKE_V3_FACTORIES = {
  56: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", // BSC PancakeSwap V3 Factory
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
  56: {
    pancakeswapV3: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
    pancakeswapV2: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    biswap: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
    apeswap: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
  },
  43114: {
    traderJoeV2: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
    pangolin: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106",
    uniswapV3: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE",
  },
  5000: {
    merchantMoe: "0xeaEE7EE68874218e3f1c40F1b39e4A02B5E40Bb6",
    agniFinance: "0x319B69888b0d11cEC22caA5034e25FfFBDc88421",
    fusionX: "0x5989FB161568b9F133eDf5Cf6787f5597762797F",
  },
  534352: {
    ambientFinance: "0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106",
    uniswapV3: "0xfc30937f5Adb2fEcb2Cf071394e3c5d2C9975733",
    syncswap: "0x80e38291e06339d10AAB483C65695D004dBD5C69",
  },
};

async function main() {
  const signers = await hre.ethers.getSigners();
  if (!signers || signers.length === 0) {
    throw new Error("No wallet configured. Please save your Private Key in Dashboard → Setup first.");
  }
  const deployer = signers[0];
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("\n====================================");
  console.log("  FLASHLOAN-AI Contract Deployment");
  console.log("====================================\n");
  console.log(`Network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${hre.ethers.formatEther(balance)} ETH\n`);

  // Xac dinh loai contract va deploy
  let contract;
  let contractAddress;
  let constructorArg;
  let contractType;

  const pancakeFactory = PANCAKE_V3_FACTORIES[chainId];
  const aaveProvider = AAVE_PROVIDERS[chainId];

  if (pancakeFactory) {
    // ===== BSC: Deploy FlashloanArbitrageBSC (PancakeSwap V3 Flash Loan) =====
    contractType = "FlashloanArbitrageBSC";
    constructorArg = pancakeFactory;
    console.log(`Flash Loan Provider: PancakeSwap V3`);
    console.log(`Factory: ${pancakeFactory}`);

    console.log(`\nDeploying ${contractType}...`);
    const ContractFactory = await hre.ethers.getContractFactory(contractType);
    contract = await ContractFactory.deploy(pancakeFactory);
  } else if (aaveProvider) {
    // ===== Cac chain khac: Deploy FlashloanArbitrage (Aave V3) =====
    contractType = "FlashloanArbitrage";
    constructorArg = aaveProvider;
    console.log(`Flash Loan Provider: Aave V3`);
    console.log(`Provider: ${aaveProvider}`);

    console.log(`\nDeploying ${contractType}...`);
    const ContractFactory = await hre.ethers.getContractFactory(contractType);
    contract = await ContractFactory.deploy(aaveProvider);
  } else {
    throw new Error(`No flash loan provider available for chainId ${chainId}. Cannot deploy.`);
  }

  await contract.waitForDeployment();
  contractAddress = await contract.getAddress();
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
  console.log(`Type: ${contractType}`);
  console.log(`Owner: ${deployer.address}`);
  console.log(`Chain: ${chainId}`);
  console.log(`Flash Loan: ${pancakeFactory ? "PancakeSwap V3" : "Aave V3"}`);
  console.log("\nNext steps:");
  console.log("1. Contract address auto-saved to Dashboard");
  console.log("2. Start bot with Paper Trading to evaluate");
  console.log("3. Switch to Live Trading when ready");
  console.log("====================================\n");

  // Verify contract (optional, skip testnet)
  if (chainId !== 31337 && chainId !== 421614 && chainId !== 84532) {
    console.log("Verifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [constructorArg],
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
