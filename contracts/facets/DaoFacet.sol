// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../diamonds/LibDiamond.sol";
import "../libs/LibIdentity.sol";
import "../libs/LibDao.sol";

interface IExecutionFacet {
    function execute(address target, uint256 value, bytes calldata data) external;
}

/// @notice DaoFacet
/// @dev Phase 5 governance facet using memberId (auth context)
contract DaoFacet {
    // =============================================================
    // Events
    // =============================================================

    event MemberAdded(bytes32 indexed memberId);
    event ProposalCreated(uint256 indexed proposalId, bytes32 indexed proposerMemberId, string description);
    event VoteCast(uint256 indexed proposalId, bytes32 indexed voterMemberId, uint8 support);
    event ProposalFinalized(uint256 indexed proposalId, LibDao.ProposalState state);
    event ProposalExecuted(uint256 indexed proposalId);

    // =============================================================
    // Errors
    // =============================================================

    error NotMember();
    error InvalidSupport();
    error AlreadyVoted();
    error InvalidState();
    error AlreadyExecuted();

    // =============================================================
    // Internal helpers
    // =============================================================

    function _currentMemberId() internal view returns (bytes32) {
        return LibIdentity.getCurrentMemberId();
    }

    function _requireMember(bytes32 memberId) internal view {
        if (!LibDao.isMember(memberId)) revert NotMember();
    }

    // =============================================================
    // Membership
    // =============================================================

    function addMember(bytes32 memberId) external {
        LibDiamond.enforceIsOwner();
        LibDao.addMember(memberId);
        emit MemberAdded(memberId);
    }

    function isMember(bytes32 memberId) external view returns (bool) {
        return LibDao.isMember(memberId);
    }

    // =============================================================
    // Governance
    // =============================================================

    function propose(
        string calldata description,
        address target,
        uint256 value,
        bytes calldata data,
        uint64 votingPeriod,
        bytes32 metaHash,
        string calldata metaURI
    ) external returns (uint256 proposalId) {
        bytes32 memberId = _currentMemberId();
        _requireMember(memberId);

        proposalId = LibDao.createProposal(
            address(this),
            description,
            target,
            value,
            data,
            votingPeriod,
            metaHash,
            metaURI
        );

        emit ProposalCreated(proposalId, memberId, description);
    }

    function castVote(uint256 proposalId, uint8 support) external {
        bytes32 memberId = _currentMemberId();
        _requireMember(memberId);

        if (support < 1 || support > 3) revert InvalidSupport();
        if (LibDao.hasVoted(proposalId, memberId)) revert AlreadyVoted();
        if (LibDao.state(proposalId) != LibDao.ProposalState.Active) revert InvalidState();

        LibDao.castVote(proposalId, memberId, support);
        emit VoteCast(proposalId, memberId, support);
    }

    function finalize(uint256 proposalId) external {
        LibDao.ProposalState st = LibDao.state(proposalId);
        if (st != LibDao.ProposalState.Succeeded && st != LibDao.ProposalState.Defeated) {
            revert InvalidState();
        }

        LibDao.finalize(proposalId);
        emit ProposalFinalized(proposalId, LibDao.state(proposalId));
    }

    // =============================================================
    // EXECUTION (⭐ new)
    // =============================================================

    function execute(uint256 proposalId) external {
        LibDao.Proposal storage p = LibDao.getProposal(proposalId);

        if (p.executed) revert AlreadyExecuted();
        if (LibDao.state(proposalId) != LibDao.ProposalState.Succeeded) {
            revert InvalidState();
        }

        // delegate actual execution to ExecutionFacet
        IExecutionFacet(address(this)).execute(p.target, p.value, p.data);

        LibDao.markExecuted(proposalId);
        emit ProposalExecuted(proposalId);
    }

    // =============================================================
    // Views
    // =============================================================

    function getProposal(uint256 proposalId) external view returns (LibDao.Proposal memory) {
        return LibDao.getProposal(proposalId);
    }

    function state(uint256 proposalId) external view returns (LibDao.ProposalState) {
        return LibDao.state(proposalId);
    }
}
