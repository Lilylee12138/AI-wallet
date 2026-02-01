// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/UserOperation.sol";

interface IAccountValidate {
    function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256);
}

contract EntryPointCaller {
    function callValidate(
        address account,
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256) {
        return IAccountValidate(account).validateUserOp(userOp, userOpHash, missingAccountFunds);
    }
}
