# JSON Contract Files

- `cli-json-contract.current.json` is the stable on-disk path for the current bundled machine contract.
- Installed npm packages ship the stable current file plus the active schema snapshot for the packaged CLI version.
- The repository may retain older `cli-json-contract.v*.json` snapshots for historical reference even when they are not included in the npm tarball.
- Runtime discovery metadata may still report the exact versioned snapshot path so callers can bind to an explicit schema version when needed.
