#!/bin/bash
# Runs a release's tests on one commit, nothing else, before it's tagged.
# poll.sh runs it for each new head of the release-check branch and reports
# the result as the commit's "Tests" status; release.sh skips its own test
# run on a commit that passed here.
#
#   check.sh <commit>
set -euo pipefail

. "$(dirname "$0")/common.sh"
commit="${1:?Usage: check.sh <commit>}"

step "Checking out ${commit:0:9}"
checkout "$commit"

step "Installing dependencies"
install_deps

step "Building"
npm run build

step "Testing"
run_tests
step "Passed"
