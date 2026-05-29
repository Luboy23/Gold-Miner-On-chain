// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGoldMinerLevelCatalog {
    struct LevelConfig {
        bytes32 levelId;
        uint32 version;
        bytes32 contentHash;
        uint32 order;
        bool enabled;
        bytes32 challengeSeed;
    }

    function getLevel(bytes32 levelId, uint32 version) external view returns (LevelConfig memory);
}

/**
 * @custom:security-contact security@example.com
 * @dev 这个合约只保存“最小可信排行榜状态”和必要的提交事件。
 * UI 所需的完整历史、分页、复杂榜单展示都应由链下 read model 负责。
 *
 * 设计取舍：
 * - 链上只保留可验证、可排序、可追责的最小结果
 * - 大体量历史数据通过事件和索引层重建
 * - ranked 与 campaign 共用会话许可和 verifier 签名体系，但榜单排序规则不同
 */
contract GoldMinerScoreboard {
    error GoldMinerScoreboard__DuplicateBatchId();
    error GoldMinerScoreboard__DuplicateCampaignId();
    error GoldMinerScoreboard__DuplicateRunId();
    error GoldMinerScoreboard__EmptyBatch();
    error GoldMinerScoreboard__InvalidBatchId();
    error GoldMinerScoreboard__InvalidCampaign();
    error GoldMinerScoreboard__InvalidChallenge();
    error GoldMinerScoreboard__InvalidDelegate();
    error GoldMinerScoreboard__InvalidDeploymentId();
    error GoldMinerScoreboard__InvalidPermitWindow();
    error GoldMinerScoreboard__InvalidPlayer();
    error GoldMinerScoreboard__InvalidPlayerSignature();
    error GoldMinerScoreboard__InvalidRunId();
    error GoldMinerScoreboard__InvalidVerifier();
    error GoldMinerScoreboard__InvalidVerifierSignature();
    error GoldMinerScoreboard__MaxRunsExceeded();
    error GoldMinerScoreboard__SessionRevoked();
    error GoldMinerScoreboard__Unauthorized();
    error GoldMinerScoreboard__VersionNotEnabled();

    struct RankedRunResult {
        bytes32 challengeId;
        uint32 challengeVersion;
        uint32 diamondsCaught;
        uint32 lastDiamondAtMs;
        bytes32 evidenceHash;
        uint64 submittedAt;
    }

    struct LeaderboardEntry {
        address player;
        RankedRunResult result;
    }

    struct CampaignResult {
        bytes32 campaignId;
        uint8 reachedLevel;
        bool completed;
        uint32 finalScore;
        uint32 totalDurationMs;
        uint16 purchasedItemCount;
        bytes32 evidenceHash;
        uint64 submittedAt;
    }

    struct CampaignLeaderboardEntry {
        address player;
        CampaignResult result;
    }

    struct HistoryBuffer {
        uint32 head;
        uint32 count;
        mapping(uint32 => RankedRunResult) entries;
    }

    struct SessionPermit {
        address player;
        address delegate;
        bytes32 sessionId;
        bytes32 deploymentIdHash;
        uint64 issuedAt;
        uint64 deadline;
        uint32 nonce;
        uint16 maxRuns;
    }

    struct VerifiedRun {
        bytes32 runId;
        bytes32 challengeId;
        uint32 challengeVersion;
        uint32 diamondsCaught;
        uint32 lastDiamondAtMs;
        bytes32 evidenceHash;
    }

    struct VerifiedCampaign {
        bytes32 campaignId;
        uint8 reachedLevel;
        bool completed;
        uint32 finalScore;
        uint32 totalDurationMs;
        uint16 purchasedItemCount;
        bytes32 evidenceHash;
    }

    struct SessionUsage {
        uint16 submittedRuns;
        bool revoked;
    }

    uint256 public constant MAX_LEADERBOARD_PER_LEVEL = 20;
    uint32 public constant MAX_HISTORY_PER_USER = 50;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SESSION_PERMIT_TYPEHASH = keccak256(
        "SessionPermit(address player,address delegate,bytes32 sessionId,bytes32 deploymentIdHash,uint64 issuedAt,uint64 deadline,uint32 nonce,uint16 maxRuns)"
    );
    bytes32 private constant VERIFIED_RUN_TYPEHASH = keccak256(
        "VerifiedRun(bytes32 runId,bytes32 challengeId,uint32 challengeVersion,uint32 diamondsCaught,uint32 lastDiamondAtMs,bytes32 evidenceHash)"
    );
    bytes32 private constant VERIFIED_BATCH_TYPEHASH = keccak256(
        "VerifierBatch(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 batchId,bytes32 runsHash)"
    );
    bytes32 private constant VERIFIED_CAMPAIGN_TYPEHASH = keccak256(
        "VerifiedCampaign(bytes32 campaignId,uint8 reachedLevel,bool completed,uint32 finalScore,uint32 totalDurationMs,uint16 purchasedItemCount,bytes32 evidenceHash)"
    );
    bytes32 private constant VERIFIER_CAMPAIGN_TYPEHASH = keccak256(
        "VerifierCampaign(address player,address delegate,bytes32 sessionId,uint32 nonce,bytes32 campaignHash)"
    );
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 private constant SESSION_PERMIT_NAME_HASH = keccak256("GoldMinerSessionPermit");
    bytes32 private constant VERIFIED_BATCH_NAME_HASH = keccak256("GoldMinerVerifiedBatch");
    bytes32 private constant VERIFIED_CAMPAIGN_NAME_HASH = keccak256("GoldMinerVerifiedCampaign");

    IGoldMinerLevelCatalog public immutable levelCatalog;
    bytes32 public immutable deploymentIdHash;

    address public owner;
    address public verifier;
    bytes32 public currentRankedChallengeId;
    uint32 public currentRankedChallengeVersion;

    mapping(bytes32 => LeaderboardEntry[]) private _leaderboards;
    CampaignLeaderboardEntry[] private _campaignLeaderboard;
    mapping(address => HistoryBuffer) private _histories;
    mapping(address => mapping(uint32 => SessionUsage)) private _sessionUsages;
    mapping(bytes32 => bool) private _recordedRuns;
    mapping(bytes32 => bool) private _recordedBatches;
    mapping(bytes32 => bool) private _recordedCampaigns;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event VerifierUpdated(address indexed previousVerifier, address indexed newVerifier);
    event RankedChallengePointerUpdated(bytes32 indexed challengeId, uint32 indexed version);
    event RunSubmitted(
        address indexed player,
        bytes32 indexed challengeId,
        uint32 indexed challengeVersion,
        uint32 diamondsCaught,
        uint32 lastDiamondAtMs,
        bytes32 evidenceHash
    );
    event VerifiedBatchSubmitted(
        address indexed player,
        address indexed delegate,
        bytes32 indexed batchId,
        bytes32 sessionId,
        uint32 nonce,
        uint256 runCount
    );
    event CampaignSubmitted(
        address indexed player,
        bytes32 indexed campaignId,
        uint8 reachedLevel,
        bool completed,
        uint32 finalScore,
        uint32 totalDurationMs,
        uint16 purchasedItemCount,
        bytes32 evidenceHash
    );

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert GoldMinerScoreboard__Unauthorized();
        }
        _;
    }

    constructor(address levelCatalogAddress, address initialVerifier, string memory deploymentId) {
        if (levelCatalogAddress == address(0)) {
            revert GoldMinerScoreboard__InvalidChallenge();
        }
        if (initialVerifier == address(0)) {
            revert GoldMinerScoreboard__InvalidVerifier();
        }
        if (bytes(deploymentId).length == 0) {
            revert GoldMinerScoreboard__InvalidDeploymentId();
        }

        levelCatalog = IGoldMinerLevelCatalog(levelCatalogAddress);
        deploymentIdHash = keccak256(bytes(deploymentId));
        owner = msg.sender;
        verifier = initialVerifier;

        emit OwnershipTransferred(address(0), msg.sender);
        emit VerifierUpdated(address(0), initialVerifier);
    }

    /*//////////////////////////////////////////////////////////////
                              OWNER FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert GoldMinerScoreboard__Unauthorized();
        }
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function updateVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) {
            revert GoldMinerScoreboard__InvalidVerifier();
        }
        emit VerifierUpdated(verifier, newVerifier);
        verifier = newVerifier;
    }

    function setCurrentRankedChallenge(bytes32 challengeId, uint32 challengeVersion) external onlyOwner {
        _requireEnabledCatalogVersion(challengeId, challengeVersion);
        currentRankedChallengeId = challengeId;
        currentRankedChallengeVersion = challengeVersion;
        emit RankedChallengePointerUpdated(challengeId, challengeVersion);
    }

    /*//////////////////////////////////////////////////////////////
                        USER-FACING STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function submitVerifiedBatch(
        SessionPermit calldata permit,
        bytes calldata playerPermitSig,
        VerifiedRun[] calldata runs,
        bytes32 batchId,
        bytes calldata verifierSig
    ) external {
        // 排位批量提交的信任边界：
        // 1. 玩家授权 delegate 会话
        // 2. verifier 为一批 runs 的 evidence 背书
        // 3. 合约只验证签名、目录启用状态和去重，不重放游戏本身
        if (permit.player == address(0)) {
            revert GoldMinerScoreboard__InvalidPlayer();
        }
        if (permit.delegate == address(0) || msg.sender != permit.delegate) {
            revert GoldMinerScoreboard__InvalidDelegate();
        }
        if (permit.deploymentIdHash != deploymentIdHash) {
            revert GoldMinerScoreboard__InvalidDeploymentId();
        }
        if (
            permit.issuedAt > block.timestamp || permit.deadline <= permit.issuedAt || block.timestamp > permit.deadline
        ) {
            revert GoldMinerScoreboard__InvalidPermitWindow();
        }
        if (permit.maxRuns == 0) {
            revert GoldMinerScoreboard__MaxRunsExceeded();
        }
        if (runs.length == 0) {
            revert GoldMinerScoreboard__EmptyBatch();
        }
        if (batchId == bytes32(0)) {
            revert GoldMinerScoreboard__InvalidBatchId();
        }
        if (_recordedBatches[batchId]) {
            revert GoldMinerScoreboard__DuplicateBatchId();
        }

        _verifyPlayerPermit(permit, playerPermitSig);
        _verifyVerifierBatch(permit, batchId, runs, verifierSig);

        SessionUsage storage usage = _sessionUsages[permit.player][permit.nonce];
        if (usage.revoked) {
            revert GoldMinerScoreboard__SessionRevoked();
        }
        if (usage.submittedRuns + runs.length > permit.maxRuns) {
            revert GoldMinerScoreboard__MaxRunsExceeded();
        }

        for (uint256 index = 0; index < runs.length; index += 1) {
            VerifiedRun calldata run = runs[index];
            if (run.runId == bytes32(0)) {
                revert GoldMinerScoreboard__InvalidRunId();
            }
            if (_recordedRuns[run.runId]) {
                revert GoldMinerScoreboard__DuplicateRunId();
            }
            _requireEnabledCatalogVersion(run.challengeId, run.challengeVersion);
            _recordedRuns[run.runId] = true;
            _insertLeaderboard(
                permit.player,
                RankedRunResult({
                    challengeId: run.challengeId,
                    challengeVersion: run.challengeVersion,
                    diamondsCaught: run.diamondsCaught,
                    lastDiamondAtMs: run.lastDiamondAtMs,
                    evidenceHash: run.evidenceHash,
                    submittedAt: uint64(block.timestamp)
                })
            );
            _appendHistory(
                permit.player,
                RankedRunResult({
                    challengeId: run.challengeId,
                    challengeVersion: run.challengeVersion,
                    diamondsCaught: run.diamondsCaught,
                    lastDiamondAtMs: run.lastDiamondAtMs,
                    evidenceHash: run.evidenceHash,
                    submittedAt: uint64(block.timestamp)
                })
            );
            emit RunSubmitted(
                permit.player,
                run.challengeId,
                run.challengeVersion,
                run.diamondsCaught,
                run.lastDiamondAtMs,
                run.evidenceHash
            );
        }

        usage.submittedRuns += uint16(runs.length);
        _recordedBatches[batchId] = true;
        emit VerifiedBatchSubmitted(permit.player, permit.delegate, batchId, permit.sessionId, permit.nonce, runs.length);
    }

    function submitVerifiedCampaign(
        SessionPermit calldata permit,
        bytes calldata playerPermitSig,
        VerifiedCampaign calldata campaign,
        bytes calldata verifierSig
    ) external {
        // campaign 只接收“已在链下完整 replay 校验通过”的摘要结果。
        // 合约不理解每一关的 actions，只负责保证会话、签名和去重成立。
        if (permit.player == address(0)) {
            revert GoldMinerScoreboard__InvalidPlayer();
        }
        if (permit.delegate == address(0) || msg.sender != permit.delegate) {
            revert GoldMinerScoreboard__InvalidDelegate();
        }
        if (permit.deploymentIdHash != deploymentIdHash) {
            revert GoldMinerScoreboard__InvalidDeploymentId();
        }
        if (
            permit.issuedAt > block.timestamp || permit.deadline <= permit.issuedAt || block.timestamp > permit.deadline
        ) {
            revert GoldMinerScoreboard__InvalidPermitWindow();
        }
        if (campaign.campaignId == bytes32(0) || campaign.reachedLevel == 0 || campaign.reachedLevel > 10) {
            revert GoldMinerScoreboard__InvalidCampaign();
        }
        if (_recordedCampaigns[campaign.campaignId]) {
            revert GoldMinerScoreboard__DuplicateCampaignId();
        }

        _verifyPlayerPermit(permit, playerPermitSig);
        _verifyVerifierCampaign(permit, campaign, verifierSig);

        _recordedCampaigns[campaign.campaignId] = true;
        _insertCampaignLeaderboard(permit.player, campaign);
    }

    /*//////////////////////////////////////////////////////////////
                        USER-FACING READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function getLeaderboard(bytes32 challengeId, uint32 challengeVersion)
        external
        view
        returns (LeaderboardEntry[] memory)
    {
        return _leaderboards[_boardKey(challengeId, challengeVersion)];
    }

    function getCampaignLeaderboard() external view returns (CampaignLeaderboardEntry[] memory) {
        return _campaignLeaderboard;
    }

    function getPlayerHistory(address player) external view returns (RankedRunResult[] memory history) {
        HistoryBuffer storage buffer = _histories[player];
        history = new RankedRunResult[](buffer.count);

        for (uint32 index = 0; index < buffer.count; index += 1) {
            uint32 cursor = (buffer.head + MAX_HISTORY_PER_USER - buffer.count + index) % MAX_HISTORY_PER_USER;
            history[index] = buffer.entries[cursor];
        }
    }

    /*//////////////////////////////////////////////////////////////
                      INTERNAL STATE-CHANGING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _insertLeaderboard(address player, RankedRunResult memory result) private {
        bytes32 key = _boardKey(result.challengeId, result.challengeVersion);
        LeaderboardEntry[] storage board = _leaderboards[key];
        LeaderboardEntry memory entry = LeaderboardEntry({player: player, result: result});

        // 排位榜单的排序不变量：
        // 1. 钻石数优先
        // 2. 最后一钻时间越短越优
        // 3. 同分同时间时，越早提交越优
        uint256 insertAt = board.length;
        for (uint256 index = 0; index < board.length; index += 1) {
            if (_isBetterResult(result, board[index].result)) {
                insertAt = index;
                break;
            }
        }

        if (insertAt == board.length && board.length >= MAX_LEADERBOARD_PER_LEVEL) {
            return;
        }

        board.push(entry);
        for (uint256 i = board.length - 1; i > insertAt; i -= 1) {
            board[i] = board[i - 1];
        }
        board[insertAt] = entry;

        if (board.length > MAX_LEADERBOARD_PER_LEVEL) {
            board.pop();
        }
    }

    function _appendHistory(address player, RankedRunResult memory result) private {
        HistoryBuffer storage buffer = _histories[player];
        uint32 cursor = buffer.head;
        buffer.entries[cursor] = result;
        buffer.head = (cursor + 1) % MAX_HISTORY_PER_USER;
        if (buffer.count < MAX_HISTORY_PER_USER) {
            buffer.count += 1;
        }
    }

    function _insertCampaignLeaderboard(address player, VerifiedCampaign calldata campaign) private {
        CampaignResult memory result = CampaignResult({
            campaignId: campaign.campaignId,
            reachedLevel: campaign.reachedLevel,
            completed: campaign.completed,
            finalScore: campaign.finalScore,
            totalDurationMs: campaign.totalDurationMs,
            purchasedItemCount: campaign.purchasedItemCount,
            evidenceHash: campaign.evidenceHash,
            submittedAt: uint64(block.timestamp)
        });
        CampaignLeaderboardEntry memory entry = CampaignLeaderboardEntry({player: player, result: result});

        // campaign 榜单的排序不变量：
        // 1. 到达更高关卡优先
        // 2. 同关卡时，已全通优先于未全通
        // 3. 再比较最终分数、总耗时、购买次数和提交先后
        uint256 insertAt = _campaignLeaderboard.length;
        for (uint256 index = 0; index < _campaignLeaderboard.length; index += 1) {
            if (_isBetterCampaignResult(result, _campaignLeaderboard[index].result)) {
                insertAt = index;
                break;
            }
        }

        if (insertAt == _campaignLeaderboard.length && _campaignLeaderboard.length >= MAX_LEADERBOARD_PER_LEVEL) {
            emit CampaignSubmitted(
                player,
                campaign.campaignId,
                campaign.reachedLevel,
                campaign.completed,
                campaign.finalScore,
                campaign.totalDurationMs,
                campaign.purchasedItemCount,
                campaign.evidenceHash
            );
            return;
        }

        _campaignLeaderboard.push(entry);
        for (uint256 i = _campaignLeaderboard.length - 1; i > insertAt; i -= 1) {
            _campaignLeaderboard[i] = _campaignLeaderboard[i - 1];
        }
        _campaignLeaderboard[insertAt] = entry;

        if (_campaignLeaderboard.length > MAX_LEADERBOARD_PER_LEVEL) {
            _campaignLeaderboard.pop();
        }

        emit CampaignSubmitted(
            player,
            campaign.campaignId,
            campaign.reachedLevel,
            campaign.completed,
            campaign.finalScore,
            campaign.totalDurationMs,
            campaign.purchasedItemCount,
            campaign.evidenceHash
        );
    }

    /*//////////////////////////////////////////////////////////////
                        INTERNAL READ-ONLY FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function _requireEnabledCatalogVersion(bytes32 challengeId, uint32 challengeVersion) private view {
        // 约束：记分板只接受目录中当前启用的 challenge/version。
        // 这样旧版本或已禁用版本的结果无法继续污染线上榜单。
        IGoldMinerLevelCatalog.LevelConfig memory config = levelCatalog.getLevel(challengeId, challengeVersion);
        if (!config.enabled) {
            revert GoldMinerScoreboard__VersionNotEnabled();
        }
    }

    function _isBetterResult(RankedRunResult memory candidate, RankedRunResult memory incumbent)
        private
        pure
        returns (bool)
    {
        if (candidate.diamondsCaught != incumbent.diamondsCaught) {
            return candidate.diamondsCaught > incumbent.diamondsCaught;
        }
        if (candidate.lastDiamondAtMs != incumbent.lastDiamondAtMs) {
            return candidate.lastDiamondAtMs < incumbent.lastDiamondAtMs;
        }
        return candidate.submittedAt < incumbent.submittedAt;
    }

    function _isBetterCampaignResult(CampaignResult memory candidate, CampaignResult memory incumbent)
        private
        pure
        returns (bool)
    {
        if (candidate.reachedLevel != incumbent.reachedLevel) {
            return candidate.reachedLevel > incumbent.reachedLevel;
        }
        if (candidate.completed != incumbent.completed) {
            return candidate.completed;
        }
        if (candidate.finalScore != incumbent.finalScore) {
            return candidate.finalScore > incumbent.finalScore;
        }
        if (candidate.totalDurationMs != incumbent.totalDurationMs) {
            return candidate.totalDurationMs < incumbent.totalDurationMs;
        }
        if (candidate.purchasedItemCount != incumbent.purchasedItemCount) {
            return candidate.purchasedItemCount < incumbent.purchasedItemCount;
        }
        return candidate.submittedAt < incumbent.submittedAt;
    }

    function _boardKey(bytes32 challengeId, uint32 challengeVersion) private pure returns (bytes32) {
        return keccak256(abi.encode(challengeId, challengeVersion));
    }

    function _verifyPlayerPermit(SessionPermit calldata permit, bytes calldata signature) private view {
        // SessionPermit 是玩家对 delegate 会话窗口的唯一授权真相源。
        // 只要 permit 任一关键字段被篡改，typed-data digest 就会变化，签名立即失效。
        bytes32 digest = _toTypedDataHash(
            keccak256(
                abi.encode(
                    SESSION_PERMIT_TYPEHASH,
                    permit.player,
                    permit.delegate,
                    permit.sessionId,
                    permit.deploymentIdHash,
                    permit.issuedAt,
                    permit.deadline,
                    permit.nonce,
                    permit.maxRuns
                )
            ),
            SESSION_PERMIT_NAME_HASH
        );
        if (_recoverSigner(digest, signature) != permit.player) {
            revert GoldMinerScoreboard__InvalidPlayerSignature();
        }
    }

    function _verifyVerifierBatch(
        SessionPermit calldata permit,
        bytes32 batchId,
        VerifiedRun[] calldata runs,
        bytes calldata signature
    ) private view {
        bytes32[] memory structHashes = new bytes32[](runs.length);
        for (uint256 index = 0; index < runs.length; index += 1) {
            VerifiedRun calldata run = runs[index];
            structHashes[index] = keccak256(
                abi.encode(
                    VERIFIED_RUN_TYPEHASH,
                    run.runId,
                    run.challengeId,
                    run.challengeVersion,
                    run.diamondsCaught,
                    run.lastDiamondAtMs,
                    run.evidenceHash
                )
            );
        }
        bytes32 runsHash = keccak256(abi.encodePacked(structHashes));
        bytes32 digest = _toTypedDataHash(
            keccak256(
                abi.encode(
                    VERIFIED_BATCH_TYPEHASH, permit.player, permit.delegate, permit.sessionId, permit.nonce, batchId, runsHash
                )
            ),
            VERIFIED_BATCH_NAME_HASH
        );
        if (_recoverSigner(digest, signature) != verifier) {
            revert GoldMinerScoreboard__InvalidVerifierSignature();
        }
    }

    function _verifyVerifierCampaign(
        SessionPermit calldata permit,
        VerifiedCampaign calldata campaign,
        bytes calldata signature
    ) private view {
        // verifier 对 campaign 的背书只覆盖“压缩后的最终结果摘要”，
        // 逐关 replay 与 evidence 真值校验已经在链下完成，合约层不重复做昂贵验证。
        bytes32 campaignHash = keccak256(
            abi.encode(
                VERIFIED_CAMPAIGN_TYPEHASH,
                campaign.campaignId,
                campaign.reachedLevel,
                campaign.completed,
                campaign.finalScore,
                campaign.totalDurationMs,
                campaign.purchasedItemCount,
                campaign.evidenceHash
            )
        );
        bytes32 digest = _toTypedDataHash(
            keccak256(
                abi.encode(
                    VERIFIER_CAMPAIGN_TYPEHASH,
                    permit.player,
                    permit.delegate,
                    permit.sessionId,
                    permit.nonce,
                    campaignHash
                )
            ),
            VERIFIED_CAMPAIGN_NAME_HASH
        );
        if (_recoverSigner(digest, signature) != verifier) {
            revert GoldMinerScoreboard__InvalidVerifierSignature();
        }
    }

    function _toTypedDataHash(bytes32 structHash, bytes32 nameHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, nameHash, VERSION_HASH, block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) {
            return address(0);
        }

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        signer = ecrecover(digest, v, r, s);
    }
}
