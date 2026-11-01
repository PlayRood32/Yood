use std::{fs, path::Path, time::Duration};

use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    process::{self, BinaryResolver},
};

const MAX_YTDLP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RELEASE_METADATA_BYTES: u64 = 2 * 1024 * 1024;
const RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

#[derive(Debug, Deserialize)]
struct Release {
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: Option<u64>,
}

fn asset_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp_linux"
    }
}

fn allowed_download_url(url: &url::Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    host == "github.com"
        || host == "api.github.com"
        || host == "objects.githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

fn parse_sha256(value: &str) -> AppResult<[u8; 32]> {
    let value = value.strip_prefix("sha256:").unwrap_or(value);
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::Network(
            "release has no valid SHA-256 digest".into(),
        ));
    }
    let mut digest = [0u8; 32];
    for (index, chunk) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = (chunk[0] as char)
            .to_digit(16)
            .ok_or_else(|| AppError::Network("release has no valid SHA-256 digest".into()))?;
        let low = (chunk[1] as char)
            .to_digit(16)
            .ok_or_else(|| AppError::Network("release has no valid SHA-256 digest".into()))?;
        digest[index] = ((high << 4) | low) as u8;
    }
    Ok(digest)
}

async fn read_limited_bytes(response: reqwest::Response, max_bytes: usize) -> AppResult<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(AppError::Network("response exceeded the size limit".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn release_asset(client: &Client, name: &str) -> AppResult<ReleaseAsset> {
    let response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "release metadata returned {}",
            response.status()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RELEASE_METADATA_BYTES)
    {
        return Err(AppError::Network(
            "release metadata is unexpectedly large".into(),
        ));
    }
    let bytes = read_limited_bytes(response, MAX_RELEASE_METADATA_BYTES as usize).await?;
    let release: Release = serde_json::from_slice(&bytes)?;
    release
        .assets
        .into_iter()
        .find(|asset| asset.name == name)
        .ok_or_else(|| AppError::Network(format!("release does not contain {name}")))
}

async fn download_verified(
    client: &Client,
    asset: &ReleaseAsset,
    temporary: &Path,
) -> AppResult<()> {
    let url = url::Url::parse(&asset.browser_download_url)
        .map_err(|_| AppError::Network("release asset URL is invalid".into()))?;
    if !allowed_download_url(&url) {
        return Err(AppError::Network("release asset URL is not trusted".into()));
    }
    if asset.size.is_some_and(|size| size > MAX_YTDLP_BYTES) {
        return Err(AppError::Network(
            "yt-dlp update is unexpectedly large".into(),
        ));
    }
    let expected = parse_sha256(
        asset
            .digest
            .as_deref()
            .ok_or_else(|| AppError::Network("release asset has no SHA-256 digest".into()))?,
    )?;
    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "yt-dlp update returned {}",
            response.status()
        )));
    }
    if !allowed_download_url(response.url()) {
        return Err(AppError::Network(
            "yt-dlp update redirected to an untrusted host".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_YTDLP_BYTES)
    {
        return Err(AppError::Network(
            "yt-dlp update is unexpectedly large".into(),
        ));
    }
    let mut file = tokio::fs::File::create(temporary).await?;
    let mut stream = response.bytes_stream();
    let mut total = 0_u64;
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total = total.saturating_add(chunk.len() as u64);
        if total > MAX_YTDLP_BYTES {
            let _ = tokio::fs::remove_file(temporary).await;
            return Err(AppError::Network(
                "yt-dlp update exceeded the size limit".into(),
            ));
        }
        hasher.update(&chunk);
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    file.sync_all().await?;
    drop(file);
    if let Some(expected_size) = asset.size {
        if total != expected_size {
            let _ = tokio::fs::remove_file(temporary).await;
            return Err(AppError::Network(
                "yt-dlp asset size does not match metadata".into(),
            ));
        }
    }
    if hasher.finalize().as_slice() != expected {
        let _ = tokio::fs::remove_file(temporary).await;
        return Err(AppError::Network(
            "yt-dlp SHA-256 verification failed".into(),
        ));
    }
    Ok(())
}

pub async fn update_ytdlp(resolver: &BinaryResolver) -> AppResult<String> {
    let destination = resolver.writable_path("yt-dlp")?;
    if let Ok(metadata) = fs::symlink_metadata(&destination) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(AppError::UnsafePath("yt-dlp destination is unsafe".into()));
        }
    }
    let client = Client::builder()
        .user_agent("Yood/1.0 yt-dlp updater")
        .timeout(Duration::from_secs(90))
        .build()?;
    let asset = release_asset(&client, asset_name()).await?;
    let temporary = destination.with_extension(format!(
        "download.{}.{}",
        std::process::id(),
        Uuid::new_v4().simple()
    ));
    if let Err(error) = download_verified(&client, &asset, &temporary).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&temporary)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&temporary, permissions)?;
    }
    validate_staged_binary(&temporary)?;
    if let Err(error) = process::binary_version(&temporary, "yt-dlp").await {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    let previous = destination.with_extension(format!("previous.{}", Uuid::new_v4().simple()));
    if destination.exists() {
        let _ = fs::remove_file(&previous);
        fs::rename(&destination, &previous)?;
    }
    if let Err(error) = fs::rename(&temporary, &destination) {
        if previous.exists() {
            let _ = fs::rename(&previous, &destination);
        }
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Storage(error.to_string()));
    }
    let version = match process::binary_version(&destination, "yt-dlp").await {
        Ok(version) => version,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            if previous.exists() {
                let _ = fs::rename(&previous, &destination);
            }
            return Err(error);
        }
    };
    let _ = fs::remove_file(previous);
    Ok(version)
}

pub fn validate_staged_binary(path: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::UnsafePath(
            "staged binary is not a regular file".into(),
        ));
    }
    Ok(())
}
