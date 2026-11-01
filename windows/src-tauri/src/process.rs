use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
    time::timeout,
};

use crate::{
    error::{AppError, AppResult},
    models::BinaryStatus,
};

const MAX_CAPTURE_BYTES: usize = 16 * 1024 * 1024;

async fn read_captured<R: AsyncRead + Unpin>(reader: &mut R) -> std::io::Result<Vec<u8>> {
    let mut captured = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        if captured.len() < MAX_CAPTURE_BYTES {
            let remaining = MAX_CAPTURE_BYTES - captured.len();
            captured.extend_from_slice(&chunk[..read.min(remaining)]);
        }
        // Keep draining after the cap so the child can finish and close its
        // pipes; only the amount retained in memory is bounded.
    }
    Ok(captured)
}

#[derive(Debug, Clone)]
pub struct BinaryResolver {
    resource_dir: Option<PathBuf>,
    app_data_dir: Option<PathBuf>,
}

impl BinaryResolver {
    pub fn new(resource_dir: Option<PathBuf>, app_data_dir: Option<PathBuf>) -> Self {
        Self {
            resource_dir,
            app_data_dir,
        }
    }

    pub fn resolve(&self, name: &str) -> AppResult<(PathBuf, bool)> {
        if !matches!(name, "yt-dlp" | "ffmpeg") {
            return Err(AppError::InvalidInput("unsupported managed binary".into()));
        }
        let filename = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        };
        let mut candidates = Vec::new();
        if let Some(data) = &self.app_data_dir {
            candidates.push((data.join("tools").join(&filename), true));
            candidates.push((
                data.join("tools").join(platform_dir()).join(&filename),
                true,
            ));
        }
        if let Some(resource) = &self.resource_dir {
            candidates.push((resource.join("binaries").join(&filename), true));
            candidates.push((
                resource
                    .join("binaries")
                    .join(platform_dir())
                    .join(&filename),
                true,
            ));
        }
        // A system copy is a development fallback. Release packaging stages both
        // tools in the first candidates above, so end users do not need a PATH install.
        if let Ok(path) = which::which(name) {
            candidates.push((path, false));
        }
        for (path, bundled) in candidates {
            let valid = if bundled {
                is_managed_executable(&path)
            } else {
                is_executable_file(&path)
            };
            if valid {
                return Ok((path, bundled));
            }
        }
        Err(AppError::NotFound(format!(
            "{name} is not bundled or available on PATH"
        )))
    }

    pub fn writable_path(&self, name: &str) -> AppResult<PathBuf> {
        if !matches!(name, "yt-dlp" | "ffmpeg") {
            return Err(AppError::InvalidInput("unsupported managed binary".into()));
        }
        let data = self.app_data_dir.as_ref().ok_or_else(|| {
            AppError::Storage("platform app-data directory is unavailable".into())
        })?;
        let directory = data.join("tools");
        std::fs::create_dir_all(&directory)?;
        Ok(directory.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        }))
    }

    pub async fn status(&self, name: &str) -> BinaryStatus {
        match self.resolve(name) {
            Ok((path, bundled)) => {
                let version = binary_version(&path, name).await.ok();
                BinaryStatus {
                    name: name.into(),
                    path: Some(path),
                    version,
                    available: true,
                    bundled,
                }
            }
            Err(_) => BinaryStatus {
                name: name.into(),
                path: None,
                version: None,
                available: false,
                bundled: false,
            },
        }
    }
}

fn platform_dir() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "windows-x86_64"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "windows-aarch64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "linux-x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "linux-aarch64"
    } else {
        "unsupported"
    }
}

fn is_managed_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub async fn binary_version(path: &Path, name: &str) -> AppResult<String> {
    let command = command(path, &["--version".to_string()])?;
    let (code, stdout, _) = capture(command, Duration::from_secs(10)).await?;
    if code != 0 {
        return Err(AppError::Process(format!("{name} returned {code}")));
    }
    let text = stdout.trim();
    if text.is_empty() {
        return Err(AppError::Process(format!("{name} returned no version")));
    }
    Ok(text.chars().take(128).collect())
}

pub fn command(path: &Path, args: &[String]) -> AppResult<Command> {
    if !is_executable_file(path) {
        return Err(AppError::NotFound(path.display().to_string()));
    }
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // yt-dlp/ffmpeg runs must never flash a console window.
        // CREATE_NO_WINDOW = 0x08000000
        command.creation_flags(0x08000000);
    }
    Ok(command)
}

pub async fn capture(
    mut command: Command,
    timeout_duration: Duration,
) -> AppResult<(i32, String, String)> {
    let mut child = command
        .spawn()
        .map_err(|error| AppError::Process(error.to_string()))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Process("stdout was not piped".into()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::Process("stderr was not piped".into()))?;
    let stdout_task =
        tokio::spawn(async move { read_captured(&mut stdout).await.unwrap_or_default() });
    let stderr_task =
        tokio::spawn(async move { read_captured(&mut stderr).await.unwrap_or_default() });
    let status = match timeout(timeout_duration, child.wait()).await {
        Ok(result) => result.map_err(|error| AppError::Process(error.to_string()))?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(AppError::Timeout);
        }
    };
    let out = stdout_task
        .await
        .map_err(|e| AppError::Process(e.to_string()))?;
    let err = stderr_task
        .await
        .map_err(|e| AppError::Process(e.to_string()))?;
    Ok((
        status.code().unwrap_or(-1),
        String::from_utf8_lossy(&out).into_owned(),
        String::from_utf8_lossy(&err).into_owned(),
    ))
}

pub async fn terminate(child: &mut Child) {
    let _ = child.start_kill();
    let _ = timeout(Duration::from_secs(3), child.wait()).await;
}
