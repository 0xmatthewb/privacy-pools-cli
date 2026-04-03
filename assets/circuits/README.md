Bundled proof artifacts live in versioned subdirectories named after the
compatible Privacy Pools SDK release, for example `v1.2.0`.

That naming is intentional:
- runtime circuit resolution derives the bundle path from the installed SDK
  compatibility version
- checksum manifests and provisioning scripts use the same version key
- packaged installs ship the bundled artifacts exactly as they appear here

If the repo ever needs a different public layout, it should happen alongside a
runtime compatibility change rather than as a cosmetic rename.
