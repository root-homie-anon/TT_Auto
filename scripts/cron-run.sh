#!/usr/bin/env bash
# cron-run.sh — Cron/launchd entry point for the TT_Auto pipeline.
#
# Behaviour:
#   - Redirects all output (stdout + stderr) to logs/YYYY-MM-DD.log
#   - Creates logs/ if it does not exist
#   - Delegates lock acquisition to Node (acquireLock inside run-pipeline.ts)
#     If the pipeline exits because a live PID already holds the lock it returns
#     a non-zero exit code, which cron/launchd interprets as "try again later".
#   - Propagates the pipeline exit code verbatim to the caller.
#
# Usage (crontab example — runs daily at 02:00 local):
#   0 2 * * * /path/to/project/scripts/cron-run.sh
#
# Usage (launchd — set StartCalendarInterval to match config.json pipeline.schedule):
#   ProgramArguments: ["/path/to/project/scripts/cron-run.sh"]

set -euo pipefail

# ── Resolve project root (directory containing this script's parent) ──────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ── Log setup ─────────────────────────────────────────────────────────────────
LOG_DIR="${PROJECT_ROOT}/logs"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%Y-%m-%d).log"

# Redirect all subsequent stdout + stderr to the dated log file (append).
exec >> "${LOG_FILE}" 2>&1

echo "=== cron-run.sh started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "Project root: ${PROJECT_ROOT}"
echo "Log file:     ${LOG_FILE}"

# ── Change to project root so npm/tsx resolve paths correctly ─────────────────
cd "${PROJECT_ROOT}"

# ── Run the pipeline ──────────────────────────────────────────────────────────
# npm run pipeline executes: tsx scripts/run-pipeline.ts
# If a live process holds pipeline.lock, acquireLock() returns false and the
# pipeline exits non-zero — that exit code propagates here unchanged.
npm run pipeline
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 0 ]; then
  echo "=== cron-run.sh completed successfully at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
else
  echo "=== cron-run.sh exited with code ${EXIT_CODE} at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
fi

exit "${EXIT_CODE}"
