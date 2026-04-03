This directory contains packaged agent skills that ship with the CLI.

The `privacy-pools-cli` subdirectory intentionally matches the packaged CLI
identity so agent-facing docs, packaged installs, and smoke tests can point at
one stable path.

If more bundled skills are added later, keep them as sibling directories under
`skills/` rather than renaming the existing package-scoped skill.
