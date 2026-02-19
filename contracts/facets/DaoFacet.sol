// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { LibDao } from "../libs/LibDao.sol";
import { LibIdentity } from "../libs/LibIdentity.sol";
import { LibDiamond } from "../diamonds/LibDiamond.sol";

contract DaoFacet {
    event ProposalCreated(uint256 indexed proposalId, bytes32 indexed proposerMemberId, string description);
    event VoteCast(uint256 indexed proposalId, bytes32 indexed voterMemberId, uint8 support, uint256 weight);
    event ProposalFinalized(uint256 indexed proposalId, LibDao.ProposalState state);
    event ProposalExecuted(uint256 indexed proposalId);

    error NotMember();
    error InvalidState();
    error VotingClosed();
    error AlreadyVoted();
    error AlreadyFinalized();
    error AlreadyExecuted();

    // =============================================================
    // Internal helpers
    // =============================================================

    /// @dev DAO state-changing ops must go through ERC-4337 EntryPoint,
    /// otherwise `currentMemberId` (auth context) could be abused.
    modifier onlyEntryPoint() {
        LibDiamond.enforceIsEntryPoint();
        _;
    }

    function _currentMemberId() internal view returns (bytes32) {
        return LibIdentity.getCurrentMemberId();
    }

    function _requireMember(bytes32 memberId) internal view {
        if (!LibDao.isMember(memberId)) revert NotMember();
    }

    // =============================================================
    // Member management (owner only)
    // =============================================================

    function addMember(bytes32 memberId) external {
        LibDiamond.enforceIsOwner();
        LibDao.addMember(memberId);
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
    ) external onlyEntryPoint returns (uint256 proposalId) {
        bytes32 memberId = _currentMemberId();
        _requireMember(memberId);

        // IMPORTANT: proposer should be the smart account (diamond), not EntryPoint
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

    /// @param support 1=for, 2=against, 3=abstain
    function castVote(uint256 proposalId, uint8 support) external onlyEntryPoint {
        bytes32 memberId = _currentMemberId();
        _requireMember(memberId);

        LibDao.Proposal storage p = LibDao.getProposal(proposalId);

        LibDao.ProposalState st = LibDao.state(proposalId);
        if (st != LibDao.ProposalState.Active) revert InvalidState();

        if (block.timestamp > p.endTime) revert VotingClosed();
        if (LibDao.hasVoted(proposalId, memberId)) revert AlreadyVoted();

        LibDao.castVote(proposalId, memberId, support);

        emit VoteCast(proposalId, memberId, support, 1);
    }

    function finalize(uint256 proposalId) external onlyEntryPoint {
        LibDao.Proposal storage p = LibDao.getProposal(proposalId);
        if (p.finalized) revert AlreadyFinalized();

        LibDao.ProposalState st = LibDao.state(proposalId);
        if (st != LibDao.ProposalState.Succeeded && st != LibDao.ProposalState.Defeated) {
            revert InvalidState();
        }

        LibDao.finalize(proposalId);
        emit ProposalFinalized(proposalId, st);
    }

    function execute(uint256 proposalId) external onlyEntryPoint {
        LibDao.Proposal storage p = LibDao.getProposal(proposalId);
        if (p.executed) revert AlreadyExecuted();

        LibDao.ProposalState st = LibDao.state(proposalId);
        if (st != LibDao.ProposalState.Succeeded) revert InvalidState();

        LibDao.markExecuted(proposalId);

        (bool ok, ) = p.target.call{ value: p.value }(p.data);
        require(ok, "EXEC_FAILED");

        emit ProposalExecuted(proposalId);
    }

    // =============================================================
    // Views
    // =============================================================

    /// @dev Return a memory copy for frontend reads.
    function getProposal(uint256 proposalId) external view returns (LibDao.Proposal memory out) {
        LibDao.Proposal storage p = LibDao.getProposal(proposalId);
        out.proposer = p.proposer;
        out.startTime = p.startTime;
        out.endTime = p.endTime;
        out.description = p.description;
        out.target = p.target;
        out.value = p.value;
        out.data = p.data;
        out.metaHash = p.metaHash;
        out.metaURI = p.metaURI;
        out.forVotes = p.forVotes;
        out.againstVotes = p.againstVotes;
        out.abstainVotes = p.abstainVotes;
        out.executed = p.executed;
        out.finalized = p.finalized;
    }

    function state(uint256 proposalId) external view returns (LibDao.ProposalState) {
        return LibDao.state(proposalId);
    }

    // =============================================================
    // Seed helpers (owner-only, for demo/test)
    // =============================================================

    function seedProposalAsOwner(
        string calldata description,
        address target,
        uint256 value,
        bytes calldata data,
        uint64 votingPeriod,
        bytes32 metaHash,
        string calldata metaURI
    ) external returns (uint256 proposalId) {
        LibDiamond.enforceIsOwner();

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

        emit ProposalCreated(proposalId, bytes32(0), description);
    }
}
