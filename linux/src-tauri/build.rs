fn main() {
    // Best-effort staging so a plain `cargo build`/`cargo tauri build` works
    // without a separate manual step. Failures are non-fatal.
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();
        let script = std::path::Path::new(&manifest_dir)
            .join("..")
            .join("scripts")
            .join("build.sh");
        if script.is_file() {
            let _ = Command::new("bash").arg(&script).arg("--stage").status();
        }
    }
    tauri_build::build();
}
