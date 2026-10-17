// The keys redact.mjs blanks, apart so tests/unit/replay-fixtures.test.ts can
// read them without running the redaction.
export const secretKeys = /^(.*token.*|.*secret.*|.*password.*|authorization|api_?key|cookie)$/i;
/** Ids of the account, its organization or this computer, however a CLI spells them. */
export const idKeys =
  /(account|org(anization)?|installation|workspace|user|device|machine)_?(id|uuid)$/i;
/** What the account is and has: plan, credit, this computer's name. */
export const accountKeys =
  /^(balance|subscription_?type|rate_?limit_?tier|overage\w*|user_?agent|hostname|organization_?name|display_?name)$/i;
