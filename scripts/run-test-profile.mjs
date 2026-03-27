import { runProfile } from "./test-profiles.mjs";

const profile = process.argv[2]?.trim();

if (!profile) {
  process.stderr.write(
    "Usage: node scripts/run-test-profile.mjs <install|conformance|conformance-all|ci|release|all>\n",
  );
  process.exit(2);
}

runProfile(profile);
