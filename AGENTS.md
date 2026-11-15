# an-shuttle working agreements

English is authoritative; maintain Simplified Chinese companion documentation.
See [简体中文](AGENTS.zh-CN.md). Code comments and examples use English.
Application adapters own target verification and observed effect receipts.
Requests, declarations and guest reports do not grant authority.

For code changes run `npm run build`, `npm test`, affected Python tests and
`npm run test:browser` for browser behavior. Native CAD changes also require the
existing native qualification workflow. Documentation/CI-routing-only changes
require diff and workflow review; do not claim new runtime acceptance.

## Branch and publication flow

- `dev-advance` is the sole development authority. Start feature branches from current
  `origin/dev-advance`; feature PRs target `dev-advance`, never another feature branch.
- `main` is stable. Promote reviewed batches through a `dev-advance` to `main` PR;
  only the user merges main. Do not push directly to main.
- Agents may merge development PRs after diff review, applicable local acceptance
  and every required CI check passes on the exact selected head. Never bypass gates.
- Keep PR scope fixed after handoff. Preserve dirty work and unmerged local branches;
  save recoverable local changes before synchronizing, and fast-forward only.
- After merging, verify remote ancestry and report repository, PR, target and commit.
  Delete merged remote feature heads; retain local work. Never force-push shared branches.
- Publish source and reviewed summaries only. Credentials, raw transcripts, private
  profiles and generated acceptance products remain local. Unclear publication scope
  requires user review. These rules do not grant runtime permissions.
