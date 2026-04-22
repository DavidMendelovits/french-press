# /french-press

Scaffolds a portable background agent for this repo. Installs a TypeScript runtime
(plan → execute → review → qa phases), a bash launcher with a mutex lock, and a vitest suite.

## Preamble — locate templates

Run this first to discover the skill's template directory.
If `~/.claude/skills/french-press/SKILL.md` exists, the skill is installed globally.
Otherwise, fall back to the in-repo copy.

```bash
FP_SKILL=$([ -f ~/.claude/skills/french-press/SKILL.md ] \
  && echo ~/.claude/skills/french-press \
  || echo "$(git rev-parse --show-toplevel)/.claude/skills/french-press")
FP_TEMPLATES="$FP_SKILL/templates"
echo "FP_SKILL: $FP_SKILL"
echo "FP_TEMPLATES: $FP_TEMPLATES"
ls "$FP_TEMPLATES/agent-core/"
```

## Step 1 — Gather defaults from existing project files

```bash
_REPO=$(basename "$(git rev-parse --show-toplevel)")
_TEST_CMD=$(node -e "const p=require('./package.json'); console.log(p.scripts?.test || 'npm test')" 2>/dev/null || echo "npm test")
_E2E_CMD=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['test:e2e'] || '')" 2>/dev/null || echo "")
echo "REPO: $_REPO"
echo "TEST_CMD: $_TEST_CMD"
echo "E2E_CMD: $_E2E_CMD"
```

Also read CLAUDE.md if it exists: `[ -f CLAUDE.md ] && cat CLAUDE.md || true`

## Step 2 — Interview (6 questions via AskUserQuestion)

### Q1 — Issue labels
Ask:

> Which GitHub issue labels should the agent work on?
> Default: `bug,enhancement` (comma-separated)

### Q2 — Test command
Ask:

> What command runs your unit tests?
> Default detected: `<_TEST_CMD>`

### Q3 — E2E command (optional)
Ask:

> What command runs your e2e tests? Leave blank to skip the QA phase.
> Default detected: `<_E2E_CMD>`

### Q4 — Deploy target
Ask:

> Where does this repo deploy?
> A) vercel
> B) fly.io
> C) railway
> D) other (type it)

### Q5 — Environment loader
Ask:

> How are environment variables managed?
> A) doppler (re-exec via doppler run)
> B) dotenv (.env.local)
> C) none (already in env)

### Q6 — GH_TOKEN source (for cron)
Cron can't read the macOS keychain. The agent needs a GitHub token at runtime.
Ask:

> How should the agent get its GitHub token in cron?
> A) Read from `~/.gh-token` file (chmod 600 — recommended)
> B) Use `$(gh auth token)` at runtime
> C) I'll set GH_TOKEN myself in crontab

## Step 3 — Write `french-press-config.json`

Based on the 6 answers, write `french-press-config.json` to the repo root:

```json
{
  "issueLabels": ["<labels from Q1, split on comma>"],
  "testCommand": "<Q2>",
  "e2eCommand": "<Q3, or omit if blank>",
  "deployTarget": "<Q4>",
  "surpriseEnabled": false,
  "retryAfterHours": 24,
  "ciTimeoutSeconds": 600,
  "envLoader": "<doppler|dotenv|none from Q5>"
}
```

Add `french-press-config.json` to `.gitignore` if it's not already there (it may contain deployment details).

## Step 4 — Copy agent-core to src/french-press/

```bash
mkdir -p src/french-press
cp "$FP_TEMPLATES/agent-core/package.json" src/french-press/
cp "$FP_TEMPLATES/agent-core/tsconfig.json" src/french-press/
cp "$FP_TEMPLATES/agent-core/.gitignore" src/french-press/
cp "$FP_TEMPLATES/agent-core/wiki.ts" src/french-press/
cp "$FP_TEMPLATES/agent-core/state.ts" src/french-press/
cp "$FP_TEMPLATES/agent-core/queue.ts" src/french-press/
cp "$FP_TEMPLATES/agent-core/phases.ts" src/french-press/
cp "$FP_TEMPLATES/agent-core/index.ts" src/french-press/
```

## Step 5 — Add postinstall hook to root package.json

Read the root `package.json`. If `scripts.postinstall` does not exist, add:
```json
"postinstall": "cd src/french-press && npm install"
```
If it already exists, append ` && cd src/french-press && npm install` to the existing value.

Write the updated `package.json` back.

## Step 6 — npm install inside src/french-press/

```bash
cd src/french-press && npm install
```

## Step 7 — Generate scripts/french-press.sh from template

Read `$FP_TEMPLATES/french-press.sh.tmpl`.
Replace the 4 template variables:

- `{{REPO_NAME}}` → basename of repo (from Step 1)
- `{{REPO_DIR}}` → absolute path to repo root (`git rev-parse --show-toplevel`)
- `{{ENV_LOADER}}` → value from Q5, one of:
  - doppler:
    ```
      [ -n "${DOPPLER_CONFIG:-}" ] && return 0
      exec doppler run -- "$0" "$@"
    ```
  - dotenv: `[ -f .env.local ] && export $(grep -v '^#' .env.local | xargs)`
  - none: `# no env loader configured`
- `{{GH_TOKEN_SOURCE}}` → one of:
  - Q6=A: `[ -f "$HOME/.gh-token" ] && export GH_TOKEN="$(cat "$HOME/.gh-token")"`
  - Q6=B: `export GH_TOKEN="$(gh auth token)"`
  - Q6=C: `# GH_TOKEN set externally in crontab`

Write to `scripts/french-press.sh`. Create `scripts/` if it doesn't exist.

```bash
chmod +x scripts/french-press.sh
```

## Step 8 — Copy test template

```bash
cp "$FP_TEMPLATES/test/french-press.test.ts.tmpl" src/french-press/french-press.test.ts
```

## Step 9 — Build and verify

```bash
cd src/french-press && npm run build
```

If `npm run build` fails, show the tsc error and stop. Do not proceed.

Also run the tests:
```bash
cd src/french-press && npm test
```

If tests fail, show the output and stop.

## Step 10 — Print cron entry and summary

Print:

```
✓ french-press installed successfully.

Add this cron entry (runs hourly 2am–10pm):
  0 2-22 * * * cd <repo-root> && bash scripts/french-press.sh >> ~/Library/Logs/<REPO>-french-press.log 2>&1

To run manually:
  bash scripts/french-press.sh

To dry-run (no git/gh/claude calls):
  bash scripts/french-press.sh --dry-run

Files created:
  src/french-press/     (TypeScript agent runtime)
  scripts/french-press.sh
  french-press-config.json
  .french-press-state.json  (created on first run)
  .french-press-wiki.jsonl  (created on first run)
```
