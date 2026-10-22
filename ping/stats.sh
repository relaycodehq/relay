#!/bin/sh
# People using Relay each day over the last 30 days, then yesterday by version and platform.
set -e
cd "$(dirname "$0")"
query() {
  npx --yes wrangler@4 d1 execute relay-ping --remote --json --command "$1" 2>/dev/null |
    jq -r '.[0].results | (.[0] // {} | keys_unsorted | @tsv), (.[] | [.[] | tostring] | @tsv)' |
    column -t -s "$(printf '\t')"
}
query "SELECT day, SUM(CASE WHEN kind = 'desktop' THEN count ELSE 0 END) AS desktop,
         SUM(CASE WHEN kind = 'headless' THEN count ELSE 0 END) AS headless, SUM(count) AS total
       FROM pings WHERE day >= date('now', '-30 days') GROUP BY day ORDER BY day DESC"
echo
query "SELECT version, platform, kind, count FROM pings
       WHERE day = date('now', '-1 day') ORDER BY count DESC"
