// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FreelanceEscrow {
    enum Status { Created, Funded, Submitted, Disputed, Paid, Refunded, Open }
    enum Outcome { RefundEmployer, PayFreelancer }
    uint256 public constant REVIEW_PERIOD = 3 days;
    uint256 public constant RESPONSE_PERIOD = 3 days;
    address public immutable arbitrator;
    mapping(uint256 => uint256) public submittedAt;

    struct Dispute {
        address openedBy;
        uint256 responseDeadline;
        bool otherPartyResponded;
    }
    mapping(uint256 => Dispute) public disputes;
    event DisputeOpened(uint256 indexed jobId, address indexed openedBy, string reason,
        uint256 openedAt, uint256 deliveryDeadline, uint256 submissionTime, uint256 responseDeadline);
    event EvidenceAdded(uint256 indexed jobId, address indexed author, string evidence);
    event DisputeResolved(uint256 indexed jobId, Outcome outcome, address recipient, uint256 amount, string reason);

    constructor(address arbitratorAddress) {
        require(arbitratorAddress != address(0), "Invalid arbitrator");
        arbitrator = arbitratorAddress;
    }

    struct Job {
        address employer;
        address freelancer;
        string title;
        string description;
        uint256 wageWei;
        uint256 deadline;
        Status status;
        string evidence;
    }

    uint256 public jobCount;
    mapping(uint256 => Job) private jobs;

    event JobCreated(uint256 indexed jobId, address indexed employer, address indexed freelancer);
    event PaymentDeposited(uint256 indexed jobId, uint256 amount);
    event WorkSubmitted(uint256 indexed jobId, string evidence);
    event PaymentReleased(uint256 indexed jobId, address indexed freelancer, uint256 amount);

    // deadline is a Unix timestamp in seconds. Creating a job does not deposit ETH.
    event JobAccepted(uint256 indexed jobId, address indexed freelancer);

    function postJob(string calldata title, string calldata description, uint256 wageWei, uint256 deadline)
        external returns (uint256) {
        return _create(title, description, address(0), wageWei, deadline);
    }

    function acceptJob(uint256 jobId) external {
        Job storage job = _job(jobId);
        require(job.status == Status.Open, "Job not open");
        require(block.timestamp < job.deadline, "Job expired");
        require(msg.sender != job.employer && msg.sender != arbitrator, "Independent freelancer required");
        job.freelancer = msg.sender;
        job.status = Status.Created;
        emit JobAccepted(jobId, msg.sender);
    }

    function createJob(
        string calldata title,
        string calldata description,
        address freelancer,
        uint256 wageWei,
        uint256 deadline
    ) external returns (uint256 jobId) {
        require(freelancer != address(0), "Invalid freelancer");
        return _create(title, description, freelancer, wageWei, deadline);
    }

    function _create(string calldata title, string calldata description, address freelancer,
        uint256 wageWei, uint256 deadline) private returns (uint256 jobId) {
        require(bytes(title).length > 0 && bytes(description).length > 0, "Missing job details");
        require(freelancer != msg.sender, "Invalid freelancer");
        require(wageWei > 0, "Wage must be positive");
        require(msg.sender != arbitrator && freelancer != arbitrator, "Arbitrator must be independent");
        require(deadline > block.timestamp, "Deadline must be in the future");

        jobId = ++jobCount;
        jobs[jobId] = Job({
            employer: msg.sender,
            freelancer: freelancer,
            title: title,
            description: description,
            wageWei: wageWei,
            deadline: deadline,
            status: freelancer == address(0) ? Status.Open : Status.Created,
            evidence: ""
        });
        emit JobCreated(jobId, msg.sender, freelancer);
    }

    function depositPayment(uint256 jobId) external payable {
        Job storage job = _job(jobId);
        require(msg.sender == job.employer, "Employer only");
        require(job.status == Status.Created, "Job not awaiting deposit");
        require(msg.value == job.wageWei, "Deposit exact wage");
        require(block.timestamp <= job.deadline, "Delivery deadline passed");
        job.status = Status.Funded;
        emit PaymentDeposited(jobId, msg.value);
    }

    function submitWork(uint256 jobId, string calldata evidence) external {
        Job storage job = _job(jobId);
        require(msg.sender == job.freelancer, "Freelancer only");
        require(job.status == Status.Funded, "Job not funded");
        require(bytes(evidence).length > 0, "Missing evidence");
        require(block.timestamp <= job.deadline, "Delivery deadline passed");
        submittedAt[jobId] = block.timestamp;
        job.evidence = evidence;
        job.status = Status.Submitted;
        emit WorkSubmitted(jobId, evidence);
    }

    function approveAndRelease(uint256 jobId) external {
        Job storage job = _job(jobId);
        require(msg.sender == job.employer, "Employer only");
        require(job.status == Status.Submitted, "Job not awaiting approval");
        _settle(job, Outcome.PayFreelancer);
        emit PaymentReleased(jobId, job.freelancer, job.wageWei);
    }

    function openDispute(uint256 jobId, string calldata reason) external {
        Job storage job = _job(jobId);
        require(msg.sender == job.employer || msg.sender == job.freelancer, "Parties only");
        require(bytes(reason).length > 0, "Missing reason");
        if (job.status == Status.Funded) {
            require(msg.sender == job.employer && block.timestamp > job.deadline, "No overdue delivery");
        } else {
            require(job.status == Status.Submitted, "No active delivery");
            uint256 reviewEnd = submittedAt[jobId] + REVIEW_PERIOD;
            if (msg.sender == job.employer) require(block.timestamp < reviewEnd, "Review closed");
            else require(block.timestamp >= reviewEnd, "Review ongoing");
        }
        job.status = Status.Disputed;
        uint256 responseEnd = block.timestamp + RESPONSE_PERIOD;
        disputes[jobId] = Dispute(msg.sender, responseEnd, false);
        emit DisputeOpened(jobId, msg.sender, reason, block.timestamp, job.deadline, submittedAt[jobId], responseEnd);
    }

    function addEvidence(uint256 jobId, string calldata evidence) external {
        Job storage job = _job(jobId);
        Dispute storage dispute = disputes[jobId];
        require(job.status == Status.Disputed, "No open dispute");
        require(msg.sender == job.employer || msg.sender == job.freelancer, "Parties only");
        require(block.timestamp < dispute.responseDeadline, "Response period ended");
        require(bytes(evidence).length > 0, "Missing evidence");
        if (msg.sender != dispute.openedBy) dispute.otherPartyResponded = true;
        emit EvidenceAdded(jobId, msg.sender, evidence);
    }

    function resolveDispute(uint256 jobId, Outcome outcome, string calldata reason) external {
        require(msg.sender == arbitrator, "Arbitrator only");
        Job storage job = _job(jobId);
        Dispute storage dispute = disputes[jobId];
        require(job.status == Status.Disputed, "No open dispute");
        require(dispute.otherPartyResponded || block.timestamp >= dispute.responseDeadline, "Awaiting response");
        require(bytes(reason).length > 0, "Missing decision reason");
        address recipient = _settle(job, outcome);
        emit DisputeResolved(jobId, outcome, recipient, job.wageWei, reason);
    }

    function _settle(Job storage job, Outcome outcome) private returns (address recipient) {
        bool payWorker = outcome == Outcome.PayFreelancer;
        job.status = payWorker ? Status.Paid : Status.Refunded;
        recipient = payWorker ? job.freelancer : job.employer;
        (bool sent, ) = payable(recipient).call{value: job.wageWei}("");
        require(sent, "Payment failed");
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function _job(uint256 jobId) private view returns (Job storage) {
        require(jobId > 0 && jobId <= jobCount, "Unknown job");
        return jobs[jobId];
    }
}
