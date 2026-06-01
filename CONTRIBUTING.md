# Contributing

## Commit Messages

This project follows [Conventional Commits](https://www.conventionalcommits.org/). All commit messages must use one of the following prefixes:

- `feat:` - A new feature
- `fix:` - A bug fix
- `chore:` - Maintenance tasks (dependencies, tooling, config)
- `docs:` - Documentation-only changes
- `refactor:` - Code changes that neither fix a bug nor add a feature

Examples:
```
feat: add S3 raw audio bucket construct
fix: correct EventBridge rule event pattern
chore: update CDK dependency to latest version
docs: update ARCHITECTURE.md with SNS topic details
refactor: extract processing Lambda into separate construct
```

## TDD Workflow

This project follows strict Test-Driven Development. Every code change must follow this cycle:

1. **Write a failing test first** - Use `aws-cdk-lib/assertions` with `Template.fromStack()` to define the expected infrastructure behavior before writing any implementation.
2. **Write the minimal code to make the test pass** - Only add enough implementation to satisfy the failing test. Do not add extra functionality.
3. **Refactor if needed** - Clean up the implementation while keeping all tests green.

Never push code without a corresponding test that was written before the implementation.

## CDK Guidance

- **Prefer L2 and L3 constructs** over L1 (Cfn*) constructs. L2/L3 constructs provide sensible defaults and best-practice configurations.
- **Always run tests and synth before pushing**:
  ```bash
  npm test
  npx cdk synth
  ```
- Keep constructs small and focused. Each construct should represent a single logical resource group.
- Follow AWS Well-Architected principles: least privilege IAM, encryption at rest, monitoring.

## Branch Naming

Use descriptive branch names with a prefix:

- `feat/` - Feature branches (e.g., `feat/add-raw-audio-bucket`)
- `fix/` - Bug fix branches (e.g., `fix/eventbridge-rule-pattern`)
- `chore/` - Maintenance branches (e.g., `chore/update-dependencies`)
- `docs/` - Documentation branches (e.g., `docs/update-architecture`)

## Architecture Reference

[ARCHITECTURE.md](./ARCHITECTURE.md) is the **single source of truth** for system design in this project.

- Before making infrastructure changes, review ARCHITECTURE.md to understand the current design
- Any pull request that adds, removes, or modifies AWS resources **must** update ARCHITECTURE.md to reflect the change
- The Mermaid diagram in ARCHITECTURE.md must stay in sync with the written description - if you change one, update the other
- When adding new processing steps, update both the Data Flow section and the diagram

If you are unsure whether your change requires an architecture doc update, err on the side of updating it.

## Pull Request Process

1. Create a feature branch from `main`.
2. Follow the TDD workflow for all changes.
3. Ensure all tests pass and `npx cdk synth` succeeds.
4. Open a pull request with a clear description of the change.
5. CI must pass before merging.
6. Squash merge into `main`.
