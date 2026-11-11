# Continue from the PC

The prompt and plans were initially uncommitted laptop files. A PC clone could not fetch them, and the laptop's absolute file links do not identify the PC's checkout. The cross-machine handoff uses the Git branch **`codex/identity-plan`** in `unixecho/Sarcafe-Portal`. Production `main` is not changed.

## Open the prompt immediately

[Full Claude Fable prompt on GitHub](https://github.com/unixecho/Sarcafe-Portal/blob/codex/identity-plan/docs/identity-system/FABLE_PROMPT.md)

[Planning pack on GitHub](https://github.com/unixecho/Sarcafe-Portal/tree/codex/identity-plan/docs/identity-system)

These URLs are independent of Windows usernames and local directories. The GitHub branch selector must be `codex/identity-plan`, not `main`.

## Retrieve into an existing PC clone without disturbing other work

In PowerShell, open the existing **Sarcafe-Portal repository on your PC**, verify its origin, and create a separate working folder:

```powershell
git remote get-url origin
git status --short
git fetch origin codex/identity-plan
git worktree add -b codex/identity-pc ../Sarcafe-identity-pc origin/codex/identity-plan
```

The origin must be `unixecho/Sarcafe-Portal`. This leaves your current branch and uncommitted work in place. Open the newly created sibling folder `Sarcafe-identity-pc` in Claude/Codex and use `docs/identity-system/FABLE_PROMPT.md` there. If that branch or folder already exists, inspect/open it; do not delete it or use `--force`. Existing uncommitted PC changes are not silently copied into the new worktree—review/integrate them deliberately if they are relevant.

If you prefer to work in a clean existing clone, `git fetch origin` followed by `git switch --track origin/codex/identity-plan` checks out the handoff branch. If the local branch already exists, use `git switch codex/identity-plan`. Do not force a switch or discard local work.

## If the PC has no clone

Run this from your preferred projects directory:

```powershell
git clone --branch codex/identity-plan https://github.com/unixecho/Sarcafe-Portal.git Sarcafe-identity-pc
```

Then open that folder in Claude. GitHub may request your normal sign-in; do not paste credentials into a chat or commit them.

## Verify before implementation

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
Test-Path docs/identity-system/FABLE_PROMPT.md
node --version
npm --version
```

The file check must print `True`. Read root `handoff.md`, then the prompt. The prompt resolves the current checkout and does not require the laptop's directory. Dependencies/browser binaries are machine-local; Fable must check/install through `npm ci` and matching Playwright setup on this PC. Do not copy laptop `node_modules`, `.env` files, credentials or signing keys. The temporary raw laptop QA logs are not Git artifacts; their summarized evidence and hashes are included in `baseline/2026-11-11.md`. Rerun tests on the PC.

Locate the actual Glisse skill in the PC/Claude environment before UI work. The laptop's missing-skill result does not prove it is missing on the PC. The repo's existing Sarcafe Glisse contract remains mandatory.

## Sharing and deployment boundary

This request authorizes sharing the planning handoff branch. It does not authorize implementing/deploying the identity system. This branch's `vercel.json` disables automatic Vercel deployment for `codex/identity-*` branches; existing cron settings and production `main` are unchanged. Existing GitHub QA/kiosk workflows target `main`. No feature implementation, production migration, real messages or pass issuance is part of this transfer. Future pushes/releases remain governed by the task's authorization requirements.

The original laptop baseline has Windows QA harness failures. First assignment remains **FABLE-000**, with actual PC baseline evidence, then independent Codex review before FABLE-001. Bring the resulting diff/test report back for QA. No feature test suite has been claimed as complete.
