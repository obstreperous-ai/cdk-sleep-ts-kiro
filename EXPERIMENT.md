# Experiment Design Document

## Overview & Goals

This repository is one cell in a structured experiment evaluating how AI coding agents perform when building production-quality cloud infrastructure under strict methodological constraints.

### Research Questions

1. **Capability**: Can AI coding agents produce fully functional, well-tested infrastructure-as-code from structured issue prompts alone?
2. **Quality**: Does enforcing strict TDD via prompt discipline produce measurably better infrastructure code?
3. **Consistency**: Do different AI agents and programming languages converge on similar architectural solutions given the same requirements?
4. **Scalability of Method**: Does the issue-driven, TDD-enforced approach scale across 14 iterative issues without quality degradation?

### Goals

- Build a complete, non-trivial cloud-native pipeline (not a toy example) using only AI agent execution
- Maintain strict TDD throughout with zero exceptions
- Document the process thoroughly enough to enable reproducibility and cross-cell comparison
- Produce a baseline for evaluating AI coding agent capabilities across languages and platforms

---

## Experimental Setup

### The 5-Language x 3-AI Matrix

This experiment uses a factorial design: **5 language/framework variants** crossed with **3 AI coding agents**, producing up to 15 independent cells. Each cell attempts to build the same system (an event-driven sleep audio processing pipeline) under the same methodological constraints.

| Dimension | Variants |
|-----------|----------|
| **Languages** | TypeScript (CDK), Python (CDK), Go (CDK), Java (CDK), and one additional variant (to be selected) |
| **AI Agents** | Kiro, and two other AI coding agents |

Each cell operates independently: same requirements, same TDD discipline, same issue-driven workflow. Differences in output reveal how language choice and agent capability interact.

### This Cell

- **AI Agent**: Kiro
- **Language/Framework**: TypeScript + AWS CDK
- **Repository**: [obstreperous-ai/cdk-sleep-ts-kiro](https://github.com/obstreperous-ai/cdk-sleep-ts-kiro)
- **Execution Period**: June 1-13, 2026
- **Issues Completed**: 14 (12 merged PRs producing code/infrastructure, 2 documentation-focused)
- **Final Test Count**: 196 tests, 100% resource coverage

---

## Methodology

### Pure Issue-Driven Development

The entire system was built through **14 iterative GitHub issues**, each representing a bounded unit of work. No code was written outside the context of a tracked issue. This approach provides:

- Complete traceability from requirement to implementation
- Natural checkpoints for quality verification
- A reproducible sequence that other cells can follow
- Clear boundaries preventing scope creep within any single session

### Strict TDD (Red-Green-Refactor)

Every feature followed a rigid cycle:

1. **Red** - Write a failing test that defines the expected behavior
2. **Green** - Write the minimal implementation to make the test pass
3. **Refactor** - Improve code quality while keeping all tests green

This was enforced through discipline blocks placed at the top of every issue, making TDD a non-negotiable protocol rather than an optional practice. The result: 196 tests covering infrastructure assertions, Lambda unit tests, pipeline orchestration logic, and end-to-end validation scenarios.

### Architecture-as-Code

[ARCHITECTURE.md](./ARCHITECTURE.md) served as a living design document, updated with every infrastructure change. This ensured:

- Documentation always reflects the actual implementation
- Mermaid diagrams stay synchronized with code
- Architectural decisions are recorded in context, not after the fact
- New issues can reference the current architecture accurately

### Conventional Commits

Every commit uses [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`), creating a machine-readable history. This enables:

- Automated changelog generation
- Clear audit trail of what changed and why
- Semantic versioning compatibility
- Easy identification of commit types for analysis

### Incremental Compounding

Each issue built on the verified output of all previous issues. There were no large rewrites, no integration phases, and no "big bang" merges. This incremental approach meant:

- Regressions were caught immediately by the existing test suite
- Each new feature had a stable, tested foundation
- The architecture grew organically from simple to complex
- Risk was bounded to the scope of the current issue

### Semantic Code Reviews

After each implementation, automated code review was performed to catch:

- Deviations from CDK best practices
- Missing test coverage
- Architecture documentation drift
- Security concerns (overly permissive IAM, missing encryption)

Fix cycles addressed review findings before merging, maintaining quality throughout.

---

## Actors & Setup

### Agent Identity

- **Agent**: Kiro
- **Role**: Senior AWS CDK TypeScript TDD Specialist
- **Persona**: Defined in [.github/AGENT_GUIDELINES.md](./.github/AGENT_GUIDELINES.md)
- **Execution Protocol**: Issue-driven, one issue per session, strict TDD discipline

### Agent Capabilities Exercised

- TypeScript and AWS CDK code generation
- Jest test authoring (infrastructure assertions, unit tests, snapshot tests)
- AWS service integration (S3, Lambda, Step Functions, DynamoDB, SNS, EventBridge, Polly, CloudWatch, X-Ray)
- Mermaid diagram generation and maintenance
- Markdown documentation authoring
- Git operations with conventional commit formatting
- CDK synthesis and validation

### Project Owner

- **Organization**: [obstreperous-ai](https://github.com/obstreperous-ai)
- **Role**: Experiment designer, issue author, quality gate enforcer
- **Contribution**: Authored all 14 issues with structured requirements, discipline blocks, and success criteria

### Toolchain

| Tool | Purpose |
|------|---------|
| AWS CDK 2.252.0 | Infrastructure-as-code framework |
| TypeScript 5.9 | Programming language |
| Jest 30 | Test framework (with aws-cdk-lib/assertions) |
| Node.js 22 | Runtime |
| GitHub Actions | CI pipeline |
| Conventional Commits | Commit discipline |

---

## Prompting Patterns & Meta-Prompts

### The 5-Discipline Framework

Every issue was structured around five non-negotiable disciplines, documented fully in [META-PROMPTS.md](./META-PROMPTS.md):

1. **Strict TDD** - Test-first always, no exceptions
2. **Architecture Synchronization** - ARCHITECTURE.md updated with every infrastructure change
3. **L2/L3 Construct Preference** - CDK best practices over raw CloudFormation
4. **Well-Architected Alignment** - AWS pillars guide all decisions
5. **Local Validation Before Push** - `npm test` + `npx cdk synth` must pass

### Issue Structure Pattern

Every issue included a consistent structure optimized for agent consumption:

```
+---------------------------+
| Discipline Block          |  <- TDD protocol, validation commands, commit format
+---------------------------+
| Context                   |  <- What exists, what needs to change
+---------------------------+
| Requirements              |  <- Numbered, verifiable requirements
+---------------------------+
| Tasks (Strict Order)      |  <- Tests FIRST, then implementation
+---------------------------+
| Success Criteria          |  <- Binary pass/fail with verification commands
+---------------------------+
```

### Key Prompt Design Principles

1. **Explicit beats implicit** - Numbered instructions prevent interpretation drift
2. **Discipline blocks prevent shortcuts** - TDD protocol at the top creates a non-negotiable constraint
3. **Validation commands are copy-pasteable** - Exact commands, not descriptions of what to run
4. **Success criteria are binary** - Pass/fail with concrete verification, not subjective quality assessments
5. **Bounded scope per issue** - One logical unit of work prevents conflation of concerns

### Prompt Evolution

The prompt structure evolved across the 14 issues:

- **Issues 1-3**: Establishing patterns (bootstrap, architecture, core resources)
- **Issues 4-8**: Steady-state execution with consistent discipline blocks
- **Issues 9-11**: Increasing complexity (error handling, observability, full processing)
- **Issue 12**: Culmination (end-to-end validation, comprehensive testing)
- **Issues 13-14**: Meta-documentation (README enrichment, this experiment document)

---

## Issue History Summary

| # | Issue | PR | Merged | Title | Tests | Key Outcome |
|---|-------|-----|--------|-------|-------|-------------|
| 1 | #1 | #2 | Jun 1 | Bootstrap: TypeScript CDK + Strict TDD + Agent Configuration | 3 | Project scaffolding, CI, agent guidelines |
| 2 | #3 | #4 | Jun 2 | Initial Architecture Design: Event-Driven Sleep Audio Pipeline | 3 | ARCHITECTURE.md with Mermaid diagrams (docs only) |
| 3 | #5 | #6 | Jun 3 | TDD: Core S3 Buckets + EventBridge Rule | 10 | Input/Output buckets, EventBridge trigger |
| 4 | #7 | #8 | Jun 4 | TDD: Step Functions State Machine Skeleton + Polly Integration | 16 | State machine with Polly synthesis task |
| 5 | #9 | #10 | Jun 5 | TDD: DynamoDB Metadata Table + Basic State Machine I/O | 27 | Metadata tracking, state machine wiring |
| 6 | #11 | #12 | Jun 6 | TDD: SNS Notifications + Basic Error Handling | 33 | Dual SNS topics (success/failure), KMS encryption |
| 7 | #13 | #14 | Jun 7 | TDD: Basic Lambda Function Skeleton + State Machine Integration | 39 | Lambda function, IAM permissions, integration |
| 8 | #15 | #16 | Jun 8 | TDD: Complete Pipeline Wiring, Input Validation & End-to-End Flow | 47 | Two-layer validation, full pipeline flow |
| 9 | #17 | #18 | Jun 9 | TDD: Pipeline Testing, Refinement & Deployment Preparation | 67 | Pipeline stack, CDK Pipelines CI/CD |
| 10 | #19 | #20 | Jun 10 | TDD: Advanced Error Handling, Retries & Observability | 83 | Retry policies, X-Ray, CloudWatch alarms |
| 11 | #21 | #22 | Jun 11 | TDD: Full Audio Processing Implementation & Output Handling | 109 | Complete Lambda processing, Polly integration |
| 12 | #23 | #24 | Jun 12 | TDD: End-to-End Validation, Documentation Polish & Project Completion | 196 | E2E tests, snapshot tests, full validation |
| 13 | #25 | #26 | Jun 13 | Documentation: Review & Enrich README + Project Structure | - | README enrichment, meta-prompting patterns |
| 14 | #27 | - | - | Documentation: Capture Experimental Design & Meta-Prompting Process | - | This document |

### Growth Trajectory

```
Tests: 3 -> 3 -> 10 -> 16 -> 27 -> 33 -> 39 -> 47 -> 67 -> 83 -> 109 -> 196
        |    |     |     |     |     |     |     |     |      |      |      |
       #1   #3    #5    #7    #9   #11   #13   #15   #17    #19    #21    #23
```

The test count grew monotonically across all 12 code-producing issues, demonstrating that no issue introduced regressions that required removing tests.

---

## Key Decisions & Trade-offs

### Serverless, Event-Driven Architecture

**Decision**: All components are serverless and pay-per-use.

**Rationale**: Near-zero idle cost, automatic scaling, no infrastructure management overhead. Well-suited for a processing pipeline with bursty, unpredictable workloads.

**Trade-off**: Cold starts on Lambda add latency for the first invocation after idle periods. Acceptable for a sleep audio pipeline where real-time processing is not required.

### Step Functions as Central Orchestrator

**Decision**: AWS Step Functions coordinates the entire pipeline rather than Lambda-to-Lambda chaining.

**Rationale**: Visual workflow representation, built-in error handling, state tracking without custom code, timeout management at the workflow level.

**Trade-off**: Additional cost per state transition compared to direct Lambda invocations. Justified by the reliability and observability gains.

### Two-Layer Validation

**Decision**: Input validation split between a Choice state (fast-fail) and Lambda (detailed checks).

**Rationale**: Minimizes compute costs for obviously invalid inputs while maintaining thorough validation for edge cases.

**Trade-off**: Validation logic lives in two places, requiring synchronization. Mitigated by clear separation of concerns (structural vs. semantic validation).

### SNS Dual Topics with KMS Encryption

**Decision**: Separate Completed and Failed SNS topics, both KMS-encrypted with the `aws/sns` managed key.

**Rationale**: Ensures downstream consumers always know the pipeline result without polling. KMS encryption satisfies compliance requirements without key management overhead.

**Trade-off**: Two topics to manage vs. one topic with message attributes for filtering. Two topics chosen for clearer subscription semantics.

### Exponential Backoff on All Tasks

**Decision**: Every state machine task has retry policies with exponential backoff.

**Rationale**: Transient AWS service failures (throttling, temporary unavailability) are automatically recovered without manual intervention.

**Trade-off**: Retries may extend execution time for persistent failures. Mitigated by bounded retry counts (2-3 attempts) before routing to the error path.

### X-Ray Tracing + CloudWatch Alarms

**Decision**: Distributed tracing and proactive alerting built from the start rather than added later.

**Rationale**: Observability is significantly harder to retrofit. Building it in from the beginning ensures all processing paths are traceable.

**Trade-off**: Additional cost for X-Ray traces and alarm evaluations. Negligible for the expected workload volume.

### DynamoDB Metadata Tracking

**Decision**: On-demand DynamoDB table with point-in-time recovery tracking pipeline execution state.

**Rationale**: Provides a queryable audit trail independent of Step Functions execution history (which has limited retention). On-demand billing avoids capacity planning.

**Trade-off**: Additional write operations on every state transition. Acceptable given DynamoDB's low per-operation cost and the pipeline's moderate throughput expectations.

---

## Preliminary Observations

### Strengths Observed

1. **TDD discipline held throughout**: All 196 tests were written before their corresponding implementations. No test was added retroactively, and no implementation was merged without passing tests.

2. **Architecture remained coherent**: Despite being built across 12 independent coding sessions, the architecture maintained internal consistency. The living ARCHITECTURE.md document prevented drift between documentation and implementation.

3. **Incremental approach prevented integration failures**: By building on verified output at each step, there were no integration phases, no merge conflicts between features, and no large-scale rework.

4. **Test count grew monotonically**: Tests were only ever added, never removed. This indicates each issue built cleanly on top of previous work without requiring architectural pivots that would invalidate existing tests.

5. **CDK L2/L3 constructs reduced boilerplate**: The agent consistently chose appropriate abstraction levels, producing clean infrastructure code that encodes AWS best practices without excessive configuration.

6. **Conventional commits create analyzable history**: The structured commit log enables programmatic analysis of what was built, when, and how the project evolved.

### Challenges Encountered

1. **Snapshot test maintenance**: As infrastructure grew, snapshot tests required intentional updates after legitimate changes. This created additional steps in later issues but also served as a valuable drift-detection mechanism.

2. **State machine definition parsing**: Verifying Step Functions orchestration logic required parsing `Fn::Join` arrays from the synthesized CloudFormation template. This is complex but enables powerful assertions about workflow behavior without deployment.

3. **CDK context propagation**: Ensuring environment context values propagated correctly through CDK Pipelines required careful testing of the pipeline stack independently from the application stack.

4. **Lambda mock isolation**: Mocking AWS SDK clients at the module level required careful setup to prevent test pollution. Each test needed fresh mock state to maintain isolation.

5. **Balancing test specificity**: Tests needed to be specific enough to catch regressions but flexible enough (via `Match.objectLike()`) to survive unrelated infrastructure additions in later issues.

### Testing Insights

- `Template.fromStack()` with `Match.objectLike()` is the optimal balance between specificity and flexibility for CDK assertions
- Snapshot testing complements property-based assertions by catching unintended drift across the entire template
- Parsing state machine definitions from synthesized output enables orchestration verification without deployment
- End-to-end validation tests (checking the full pipeline flow through parsed definitions) provide confidence that individual components integrate correctly
- Module-level AWS SDK mocking enables isolated Lambda unit testing with full control over service responses

### Architecture Fitness

The serverless, event-driven architecture proved well-suited for:

- **Bursty workloads**: Pay-per-use model means zero cost during idle periods
- **Multi-step processing**: Step Functions naturally models sequential and parallel processing steps
- **Failure recovery**: Built-in retry policies handle transient failures automatically
- **Audit requirements**: DynamoDB metadata + CloudWatch logs + X-Ray traces provide complete observability
- **Rapid iteration**: Infrastructure-as-code enables safe refactoring with test verification

### Observations on AI Agent Behavior

- Explicit, numbered instructions produce more consistent output than narrative descriptions
- Discipline blocks at the top of issues establish a "mode" that persists through the session
- Copy-pasteable validation commands prevent the agent from inventing incorrect verification steps
- Bounded scope per issue prevents quality degradation from context overload
- Referencing prior work explicitly ("the S3 bucket from Issue #5") prevents the agent from recreating existing infrastructure
- Success criteria as a checklist provides a clear "done" signal, preventing both under-delivery and over-engineering

---

## Conclusion

This cell of the experiment demonstrates that a structured, discipline-enforced approach to AI coding agent development can produce a complete, well-tested, production-quality infrastructure system. The combination of strict TDD, issue-driven development, architecture-as-code, and explicit prompt engineering created a reliable execution framework that maintained quality across 14 iterative issues.

The resulting system (196 tests, 100% resource coverage, full observability, proper error handling) represents a non-trivial cloud-native application built entirely by an AI coding agent operating within carefully designed constraints. The methodology is reproducible and provides a foundation for cross-cell comparison within the broader 5-language x 3-AI experimental matrix.

---

## References

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Full system architecture with Mermaid diagrams
- [META-PROMPTS.md](./META-PROMPTS.md) - Reusable prompt templates and the 5-discipline framework
- [SUMMARY.md](./SUMMARY.md) - Technical summary of what was built
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Development workflow and commit standards
- [.github/AGENT_GUIDELINES.md](./.github/AGENT_GUIDELINES.md) - Agent persona and execution protocol
