These fixtures pin the upstream source inputs used by required conformance tests.

- `0xbow-io/privacy-pools-core` fixtures are pinned to `a80836a47451e662f127af17e11430ffa976c234` (`main` as of 2026-03-19).
- Required core conformance reads these local files by default for deterministic CI.
- Set `CONFORMANCE_FETCH_LIVE=1` to bypass fixtures and fetch live GitHub sources.
- Frontend parity remains live-by-design because that workflow is intentionally informative and non-blocking.
