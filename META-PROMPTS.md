# Meta-Prompts for Agentic TDD Infrastructure-as-Code

## Overview

This document captures reusable prompt patterns and meta-prompting strategies that emerged from building the CDK Sleep Audio Pipeline entirely with AI coding agents. Meta-prompting in this context refers to the practice of structuring instructions, constraints, and workflow protocols so that AI agents consistently produce high-quality, test-driven infrastructure code.

The project was developed through 12+ iterative GitHub issues, each following a strict discipline block that guided the agent through TDD cycles, architecture synchronization, and validation. These patterns proved effective at maintaining code quality, preventing regressions, and producing a coherent system across many independent agent sessions.

## Core Prompt Pattern

Every interaction with the coding agent follows a consistent structure built on five disciplines:

### 1. Strict TDD (Test-First Always)

The agent must write failing tests before writing implementation code. This prevents "implementation-first" drift where the agent writes code and then retroactively adds tests.

**Key constraint:** "Write a failing test that asserts [specific behavior]. Run it to confirm it fails. Only then write the minimal implementation to make it pass."

### 2. Architecture Synchronization

ARCHITECTURE.md serves as the living design document. After every infrastructure change, the agent must update the architecture documentation and Mermaid diagram to reflect the new state.

**Key constraint:** "After implementation passes all tests, update ARCHITECTURE.md to reflect the changes. The Mermaid diagram must match the written description."

### 3. L2/L3 Construct Preference

AWS CDK provides three levels of constructs. L2 and L3 constructs encode AWS best practices (encryption, least privilege, proper defaults) and should always be preferred over L1 (CloudFormation-level) constructs.

**Key constraint:** "Use L2 or L3 CDK constructs. Only use L1 (Cfn*) constructs if the required configuration is not available at higher levels."

### 4. Well-Architected Alignment

All infrastructure decisions should align with the AWS Well-Architected Framework pillars: operational excellence, security, reliability, performance efficiency, cost optimization, and sustainability.

**Key constraint:** "Follow AWS Well-Architected principles: least-privilege IAM policies, encryption at rest, monitoring and alarms, cost-efficient resource configuration."

### 5. Local Validation Before Push

The agent must validate that tests pass and CDK synthesis succeeds before considering work complete. This catches configuration drift, missing permissions, and circular dependencies early.

**Key constraint:** "Run `npm test` and `npx cdk synth --context environment=dev` to confirm everything works. Do not push until both succeed."

## Issue-Driven Workflow Patterns

### Issue Structure Template

Each GitHub issue should follow this structure for optimal agent consumption:

```markdown
## Discipline Block (at the top of every issue)

> **TDD Protocol:**
> 1. Write a failing test first
> 2. Write the minimal code to pass
> 3. Refactor with all tests green
> 4. Update ARCHITECTURE.md
>
> **Validation:** `npm test && npx cdk synth --context environment=dev`
> **Commit format:** Conventional commits (feat:, fix:, chore:, docs:, refactor:)

## Context

Brief description of what exists and what needs to change.

## Requirements

Numbered list of specific, verifiable requirements.

## Tasks (Strict Order)

1. Write tests for [requirement]
2. Implement [requirement]
3. Write tests for [next requirement]
4. Implement [next requirement]
5. Update ARCHITECTURE.md
6. Run full validation

## Success Criteria

- [ ] All new tests pass
- [ ] All existing tests still pass
- [ ] CDK synth succeeds
- [ ] ARCHITECTURE.md updated
- [ ] Conventional commit message used
```

### Key Principles for Issue Design

1. **Explicit ordering** - Tasks must be numbered and ordered. "Write test first" should appear before "implement feature."
2. **Measurable success criteria** - Each criterion should be binary (pass/fail) with a concrete verification command.
3. **Bounded scope** - Each issue should represent a single logical unit of work. If requirements span multiple concerns, split into multiple issues.
4. **Build on previous** - Reference prior issues and existing architecture so the agent has context about what already exists.

## Reusable Prompt Templates

### Creating a New CDK Construct

```markdown
## Task: Add [Resource Name] Construct

**Discipline:** Strict TDD. Write failing tests first.

### Requirements

1. Create a [Resource Type] with the following configuration:
   - [Config item 1]
   - [Config item 2]
   - Encryption: [encryption approach]
   - Access: [access control approach]

### Tasks

1. In `test/cdk-base.test.ts`, write a test asserting the [Resource Type] exists with the specified configuration using `Template.fromStack()` and `Match.objectLike()`.
2. Run the test to confirm it fails.
3. In `lib/cdk-base-stack.ts`, add the [Resource Type] construct with the required configuration.
4. Run tests to confirm they pass.
5. Update ARCHITECTURE.md: add the resource to the Components table, update the Mermaid diagram.
6. Run `npm test && npx cdk synth --context environment=dev`.

### Success Criteria

- [ ] Test asserts [Resource Type] properties
- [ ] Resource created with [specific config]
- [ ] All tests pass
- [ ] ARCHITECTURE.md updated with new component
```

### Adding a Lambda Function

```markdown
## Task: Add [Function Name] Lambda

**Discipline:** Strict TDD. Write failing tests first.

### Requirements

1. Lambda function with:
   - Runtime: Node.js 22.x
   - Memory: [value]MB
   - Timeout: [value]s
   - Handler: [handler path]
   - Environment variables: [list]
2. IAM permissions: [list of required permissions]
3. Processing logic: [description]

### Tasks

1. Write CDK test asserting Lambda resource exists with specified configuration.
2. Write CDK test asserting IAM policy grants required permissions.
3. Implement the Lambda construct in the stack.
4. Write unit tests for the Lambda handler logic (mock AWS SDK clients).
5. Implement the Lambda handler in `lambda/[function-name]/index.ts`.
6. Update ARCHITECTURE.md with Lambda details.
7. Validate: `npm test && npx cdk synth --context environment=dev`.

### Success Criteria

- [ ] CDK tests pass for Lambda resource and IAM policy
- [ ] Unit tests pass for handler logic
- [ ] Handler implements [processing description]
- [ ] ARCHITECTURE.md updated
```

### Adding Observability

```markdown
## Task: Add Observability for [Component]

**Discipline:** Strict TDD. Write failing tests first.

### Requirements

1. CloudWatch Alarm monitoring [metric] on [resource]
   - Threshold: [value]
   - Period: [value]
   - Evaluation periods: [value]
   - Alarm action: SNS topic [topic name]
2. X-Ray tracing enabled on [resource]
3. Structured logging with fields: [list]

### Tasks

1. Write test asserting CloudWatch Alarm exists with correct threshold and action.
2. Implement the alarm construct.
3. Write test asserting X-Ray tracing is enabled.
4. Enable tracing on the resource.
5. Write unit tests for structured log output format.
6. Implement structured logging in the handler.
7. Update ARCHITECTURE.md Observability section.
8. Validate: `npm test && npx cdk synth --context environment=dev`.

### Success Criteria

- [ ] Alarm fires to correct SNS topic
- [ ] X-Ray tracing active
- [ ] Logs include required fields
- [ ] ARCHITECTURE.md Observability section updated
```

### Documentation Tasks

```markdown
## Task: Update Documentation for [Topic]

**Discipline:** Documentation must accurately reflect the current implementation.

### Requirements

1. [Specific documentation updates needed]
2. All internal links must resolve correctly
3. Mermaid diagrams must match implementation

### Tasks

1. Review current state of [files to update].
2. Update [file] with [specific content].
3. Verify all internal links resolve (check relative paths).
4. Run `npm test` to ensure no code changes were accidentally introduced.
5. Run `npx cdk synth --context environment=dev` to confirm synth still works.

### Success Criteria

- [ ] [Specific documentation content] present
- [ ] All internal links valid
- [ ] No code changes introduced
- [ ] Tests still pass
```

## Best Practices

### Lessons Learned from Building with AI Agents

**1. Explicit beats implicit.** AI agents perform best with explicit, numbered instructions. Ambiguous requirements lead to interpretation drift. Always state exactly what to test, what to implement, and in what order.

**2. Discipline blocks prevent shortcuts.** Placing the TDD protocol at the top of every issue creates a consistent mental model. Without it, agents tend to write implementation first and tests second (or skip tests for "simple" changes).

**3. Validation commands must be copy-pasteable.** Give the exact commands to run. Do not assume the agent knows the project's test runner or synthesis command.

**4. Architecture-as-code documentation works.** Keeping ARCHITECTURE.md in sync with every change creates a living document that is always accurate. This is more reliable than periodic documentation sweeps.

**5. Incremental issues compound.** Building the project through 12+ small, focused issues (rather than one large specification) allowed each issue to build on verified, working infrastructure. Each issue assumed the previous issue's work was complete and tested.

### Testing Insights

- **`Template.fromStack()` with `Match.objectLike()`** enables flexible assertions that survive unrelated changes. Test specific properties you care about rather than the entire resource definition.
- **Snapshot testing** catches unintended drift but requires intentional updates after legitimate changes. Agents should be told when to update snapshots vs. when snapshot failures indicate a problem.
- **Parsing state machine definitions** (extracting from `Fn::Join` parts in the synthesized template) enables verification of orchestration logic without deployment. This is powerful for testing Step Functions workflows.
- **Mocking AWS SDK clients** at the module level allows isolated Lambda unit testing. Use `jest.mock()` with manual mock implementations that track calls.

### CDK-Specific Patterns

- **Two-layer validation** (Choice state + Lambda) balances cost efficiency with error detail. Fast-fail in the state machine for obviously bad inputs; detailed validation in Lambda for nuanced checks.
- **SNS KMS encryption** using the `aws/sns` managed key eliminates key management overhead while maintaining encryption at rest.
- **CDK context for environment selection** enables multi-environment deployment without code duplication or environment-specific stacks.
- **Retry policies with exponential backoff** should be defined on every task state. Transient AWS service failures are common and should be handled automatically.

### Agent Session Management

- **One issue per session** keeps context focused and prevents the agent from conflating requirements across features.
- **Reference previous work explicitly** ("The S3 bucket from Issue #3 already exists") prevents the agent from recreating existing infrastructure.
- **Success criteria as a checklist** gives the agent a clear "done" signal. Without it, agents tend to either stop too early or over-engineer.
