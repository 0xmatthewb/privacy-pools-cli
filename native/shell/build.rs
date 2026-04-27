use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let version_path = manifest_dir.join("../../version.txt");
    let version = fs::read_to_string(&version_path)
        .expect("root version.txt must be readable")
        .trim()
        .to_string();
    assert!(!version.is_empty(), "root version.txt must not be empty");
    assert_eq!(
        version,
        std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION must be set"),
        "root version.txt must match native/shell/Cargo.toml package.version",
    );

    println!("cargo:rustc-env=CLI_VERSION={version}");
    println!("cargo:rerun-if-changed={}", version_path.display());
}
