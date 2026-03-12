// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library LibConfig {
    bytes32 internal constant CONFIG_STORAGE_POSITION =
        keccak256("ai.wallet.config.storage");

    struct ConfigStorage {
        uint16 riskThresholdBps;   // e.g. 7000 = 70.00%
        uint8 validationMode;      // 0 = permissive, 1 = strict
        bool aiExplainEnabled;     // transfer / general AI explain
        bool swapAdviceEnabled;    // swap AI advice / explanation
        bool initialized;
    }

    function configStorage() internal pure returns (ConfigStorage storage cs) {
        bytes32 position = CONFIG_STORAGE_POSITION;
        assembly {
            cs.slot := position
        }
    }
}

interface IOwnershipLike {
    function owner() external view returns (address);
}

contract ConfigFacet {
    event RiskThresholdUpdated(uint16 oldValue, uint16 newValue);
    event ValidationModeUpdated(uint8 oldValue, uint8 newValue);
    event AiExplainEnabledUpdated(bool oldValue, bool newValue);
    event SwapAdviceEnabledUpdated(bool oldValue, bool newValue);

    modifier onlyOwner() {
        address contractOwner;

        // 兼容两种情况：
        // 1) 你的 Diamond 后面会实现标准 owner()
        // 2) 当前如果还没有 owner()，这里会 revert，提醒你要么先接 ownership，要么临时改成已有权限逻辑
        try IOwnershipLike(address(this)).owner() returns (address o) {
            contractOwner = o;
        } catch {
            revert("ConfigFacet: owner() not available on diamond");
        }

        require(msg.sender == contractOwner, "ConfigFacet: not owner");
        _;
    }

    function initConfigDefaults() external onlyOwner {
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        require(!cs.initialized, "ConfigFacet: already initialized");

        cs.riskThresholdBps = 7000;
        cs.validationMode = 0; // permissive
        cs.aiExplainEnabled = true;
        cs.swapAdviceEnabled = true;
        cs.initialized = true;
    }

    // -------------------------
    // setters
    // -------------------------

    function setRiskThresholdBps(uint16 newValue) external onlyOwner {
        require(newValue <= 10000, "ConfigFacet: invalid bps");
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        uint16 oldValue = cs.riskThresholdBps;
        cs.riskThresholdBps = newValue;
        emit RiskThresholdUpdated(oldValue, newValue);
    }

    function setValidationMode(uint8 newValue) external onlyOwner {
        require(newValue <= 1, "ConfigFacet: invalid mode");
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        uint8 oldValue = cs.validationMode;
        cs.validationMode = newValue;
        emit ValidationModeUpdated(oldValue, newValue);
    }

    function setAiExplainEnabled(bool newValue) external onlyOwner {
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        bool oldValue = cs.aiExplainEnabled;
        cs.aiExplainEnabled = newValue;
        emit AiExplainEnabledUpdated(oldValue, newValue);
    }

    function setSwapAdviceEnabled(bool newValue) external onlyOwner {
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        bool oldValue = cs.swapAdviceEnabled;
        cs.swapAdviceEnabled = newValue;
        emit SwapAdviceEnabledUpdated(oldValue, newValue);
    }

    // -------------------------
    // getters
    // -------------------------

    function getRiskThresholdBps() external view returns (uint16) {
        return LibConfig.configStorage().riskThresholdBps;
    }

    function getValidationMode() external view returns (uint8) {
        return LibConfig.configStorage().validationMode;
    }

    function getAiExplainEnabled() external view returns (bool) {
        return LibConfig.configStorage().aiExplainEnabled;
    }

    function getSwapAdviceEnabled() external view returns (bool) {
        return LibConfig.configStorage().swapAdviceEnabled;
    }

    function getConfig()
        external
        view
        returns (
            uint16 riskThresholdBps,
            uint8 validationMode,
            bool aiExplainEnabled,
            bool swapAdviceEnabled,
            bool initialized
        )
    {
        LibConfig.ConfigStorage storage cs = LibConfig.configStorage();
        return (
            cs.riskThresholdBps,
            cs.validationMode,
            cs.aiExplainEnabled,
            cs.swapAdviceEnabled,
            cs.initialized
        );
    }
}