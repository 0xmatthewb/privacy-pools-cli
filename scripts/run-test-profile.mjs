import { runProfile, TEST_PROFILES } from "./test-profiles.mjs";

const profile = process.argv[2]?.trim();

if (!profile) {
  process.stderr.write(
    `Usage: node scripts/run-test-profile.mjs <${Object.keys(TEST_PROFILES).join("|")}>\n`,
  );
  process.exit(2);
}

runProfile(profile);
