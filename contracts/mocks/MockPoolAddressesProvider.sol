// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";

/**
 * @notice Mock Pool cho testing
 */
contract MockPool {
    function flashLoanSimple(
        address,
        address,
        uint256,
        bytes calldata,
        uint16
    ) external pure {
        revert("MockPool: flashloan not supported in test");
    }

    function liquidationCall(
        address,
        address,
        address,
        uint256,
        bool
    ) external pure {
        revert("MockPool: liquidation not supported in test");
    }
}

contract MockPoolAddressesProvider is IPoolAddressesProvider {
    address public pool;
    mapping(bytes32 => address) private _addresses;

    constructor() {
        MockPool mockPool = new MockPool();
        pool = address(mockPool);
    }

    function getMarketId() external pure override returns (string memory) {
        return "MockMarket";
    }

    function setMarketId(string calldata) external override {}

    function getAddress(bytes32 id) external view override returns (address) {
        return _addresses[id];
    }

    function setAddressAsProxy(bytes32, address) external override {}

    function setAddress(bytes32 id, address newAddress) external override {
        _addresses[id] = newAddress;
    }

    function getPool() external view override returns (address) {
        return pool;
    }

    function setPoolImpl(address) external override {}

    function getPoolConfigurator() external pure override returns (address) {
        return address(0);
    }

    function setPoolConfiguratorImpl(address) external override {}

    function getPriceOracle() external pure override returns (address) {
        return address(0);
    }

    function setPriceOracle(address) external override {}

    function getACLManager() external pure override returns (address) {
        return address(0);
    }

    function setACLManager(address) external override {}

    function getACLAdmin() external pure override returns (address) {
        return address(0);
    }

    function setACLAdmin(address) external override {}

    function getPriceOracleSentinel() external pure override returns (address) {
        return address(0);
    }

    function setPriceOracleSentinel(address) external override {}

    function getPoolDataProvider() external pure override returns (address) {
        return address(0);
    }

    function setPoolDataProvider(address) external override {}
}
