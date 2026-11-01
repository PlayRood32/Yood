use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::{
    fs,
    fs::OpenOptions,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::Duration,
};

use adblock::{
    lists::{FilterSet, ParseOptions},
    request::Request,
    Engine,
};
use chrono::{Duration as ChronoDuration, Utc};
use futures_util::{stream, StreamExt};
use reqwest::{header, Client, StatusCode};

use crate::{
    error::{AppError, AppResult},
    models::{FilterScriptRules, FilterStatus, Settings, MAX_FILTER_LIST_SOURCES},
    settings,
};

const MAX_FILTER_LIST_BYTES: usize = 8 * 1024 * 1024;
const MAX_COMBINED_FILTER_BYTES: usize = 32 * 1024 * 1024;
const MAX_FILTER_LINES: usize = 500_000;
const MAX_FILTER_LINE_BYTES: usize = 32 * 1024;
static FILTER_WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
struct CompiledRules {
    engine: Arc<Engine>,
    rule_count: usize,
}

#[derive(Clone)]
pub struct FilterManager {
    cache_path: PathBuf,
    source_cache_dir: PathBuf,
    rules: Arc<RwLock<Arc<CompiledRules>>>,
    cache_loaded: Arc<AtomicBool>,
    cache_gate: Arc<Mutex<()>>,
    tracking_protection: Arc<AtomicBool>,
}

impl FilterManager {
    pub fn new(cache_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&cache_dir)?;
        let cache_path = cache_dir.join("filters.cache");
        let source_cache_dir = cache_dir.join("sources");
        fs::create_dir_all(&source_cache_dir)?;

        // Start with the small, mandatory built-in list. The potentially large
        // remote cache is compiled lazily on first use instead of making app
        // startup pay the parser and memory cost in Brave mode as well.
        let compiled = compile_rules(include_str!("../../../shared/filters/default.txt"), "");
        Ok(Self {
            cache_path,
            source_cache_dir,
            rules: Arc::new(RwLock::new(Arc::new(compiled))),
            cache_loaded: Arc::new(AtomicBool::new(false)),
            cache_gate: Arc::new(Mutex::new(())),
            tracking_protection: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn set_tracking_protection(&self, enabled: bool) {
        self.tracking_protection.store(enabled, Ordering::Release);
    }

    pub fn tracking_protection_enabled(&self) -> bool {
        self.tracking_protection.load(Ordering::Acquire)
    }

    pub fn cache_is_loaded(&self) -> bool {
        self.cache_loaded.load(Ordering::Acquire)
    }

    fn ensure_cache_loaded(&self) -> AppResult<()> {
        if self.cache_is_loaded() {
            return Ok(());
        }
        let _guard = self
            .cache_gate
            .lock()
            .map_err(|_| AppError::Internal("filter cache lock poisoned".into()))?;
        if self.cache_is_loaded() {
            return Ok(());
        }
        let cached = read_cache(&self.cache_path)?;
        let compiled = compile_rules(include_str!("../../../shared/filters/default.txt"), &cached);
        {
            let mut rules = self
                .rules
                .write()
                .map_err(|_| AppError::Internal("filter rule lock poisoned".into()))?;
            *rules = Arc::new(compiled);
        }
        self.cache_loaded.store(true, Ordering::Release);
        Ok(())
    }

    pub fn status(&self, settings: &Settings) -> FilterStatus {
        let rule_count = self
            .rules
            .read()
            .map(|rules| rules.rule_count)
            .unwrap_or_default();
        FilterStatus {
            enabled: true,
            tracking_enabled: self.tracking_protection_enabled(),
            aggressive_tracking_enabled: settings.aggressive_tracking_protection,
            tracking_supported: true,
            cache_loaded: self.cache_is_loaded(),
            rule_count,
            last_success: settings.filter_last_success,
            cache_path: Some(self.cache_path.clone()),
        }
    }

    pub fn script_rules(
        &self,
        page_url: &str,
        classes: &[String],
        ids: &[String],
    ) -> FilterScriptRules {
        // A cache read/parse failure should not take down request filtering;
        // the built-in engine remains usable in that case.
        let _ = self.ensure_cache_loaded();
        let Ok(rules) = self.rules.read() else {
            return FilterScriptRules {
                blocked_hosts: Vec::new(),
                cosmetic_selectors: Vec::new(),
            };
        };
        let resources = rules.engine.url_cosmetic_resources(page_url);
        let mut selectors = resources.hide_selectors;
        if !resources.generichide {
            selectors.extend(rules.engine.hidden_class_id_selectors(
                classes,
                ids,
                &resources.exceptions,
            ));
        }
        let mut cosmetic_selectors = selectors
            .into_iter()
            .filter(|selector| is_safe_selector(selector))
            .take(10_000)
            .collect::<Vec<_>>();
        cosmetic_selectors.sort_unstable();
        cosmetic_selectors.dedup();
        FilterScriptRules {
            // Network decisions are made by the compiled engine. The field is
            // retained for compatibility with older frontend bundles.
            blocked_hosts: Vec::new(),
            cosmetic_selectors,
        }
    }

    pub fn matches_blocked(&self, url: &str, tracking_protection: bool) -> bool {
        self.check_network_request_with_policy(
            url,
            "https://www.youtube.com/",
            "other",
            tracking_protection,
        )
    }

    /// Compatibility entry point used by the native WebView filter. The
    /// active tracking policy is kept in the manager so callers do not need a
    /// second argument while settings are being changed at runtime.
    pub fn check_network_request(&self, url: &str, source_url: &str, request_type: &str) -> bool {
        self.check_network_request_with_policy(
            url,
            source_url,
            request_type,
            self.tracking_protection_enabled(),
        )
    }

    fn check_network_request_with_policy(
        &self,
        url: &str,
        source_url: &str,
        request_type: &str,
        tracking_protection: bool,
    ) -> bool {
        if url.len() > 16 * 1024
            || source_url.len() > 16 * 1024
            || request_type.len() > 64
            || url.chars().any(char::is_control)
            || source_url.chars().any(char::is_control)
            || request_type.chars().any(char::is_control)
        {
            return false;
        }
        // Hard safety net: never let a filter-list rule block YouTube's own
        // video/audio streaming CDN. A false positive here doesn't just hide
        // an ad, it silently breaks playback.
        if let Ok(parsed) = url::Url::parse(url) {
            if let Some(host) = parsed.host_str() {
                if host == "googlevideo.com" || host.ends_with(".googlevideo.com") {
                    return false;
                }
            }
        }
        let Ok(request) = Request::new(url, source_url, request_type, "GET") else {
            return false;
        };
        let _ = self.ensure_cache_loaded();
        let mut blocked = self
            .rules
            .read()
            .ok()
            .map(|rules| rules.engine.check_network_request(&request).should_block())
            .unwrap_or(false);
        if !blocked && tracking_protection && is_tracking_url(url) {
            blocked = true;
        }
        blocked
    }

    pub async fn update_if_due(&self, settings: &mut Settings, force: bool) -> AppResult<bool> {
        let due = force
            || settings
                .filter_last_success
                .map(|last| Utc::now() - last > ChronoDuration::hours(24))
                .unwrap_or(true);
        if !due {
            return Ok(false);
        }
        self.update(settings).await
    }

    async fn update(&self, settings: &mut Settings) -> AppResult<bool> {
        let client = Client::builder()
            .user_agent("Yood/0.1 filter updater")
            .timeout(Duration::from_secs(15))
            .build()?;
        let mut sources = Vec::new();
        let mut seen = HashSet::new();
        for source in &settings.filter_list_urls {
            if sources.len() >= MAX_FILTER_LIST_SOURCES {
                return Err(AppError::InvalidInput(
                    "too many filter list sources".into(),
                ));
            }
            settings::validate_filter_source(source)?;
            if seen.insert(source.clone()) {
                sources.push(source.clone());
            }
        }
        if sources.is_empty() {
            return Ok(false);
        }

        // Fetch every list concurrently. Each source is independent: a fresh
        // download replaces its on-disk copy, a failure falls back to that
        // copy. One slow/blocked host must never discard the other lists.
        let fetches = sources.iter().cloned().enumerate().map(|(index, source)| {
            let client = client.clone();
            let etag = settings.filter_etags.get(&source).cloned();
            let path = source_cache_path(&self.source_cache_dir, &source);
            async move { (index, fetch_one_source(&client, &source, etag, &path).await) }
        });
        let mut fetched: Vec<_> = (0..sources.len()).map(|_| None).collect();
        let mut results = stream::iter(fetches).buffer_unordered(4);
        while let Some((index, result)) = results.next().await {
            fetched[index] = Some(result);
        }
        drop(results);
        let mut etags = Vec::new();
        let mut bodies = Vec::with_capacity(sources.len());
        for result in fetched.into_iter().flatten() {
            if let Some(etag) = result.etag {
                etags.push(etag);
            }
            if let Some(body) = result.body {
                bodies.push(body);
            }
        }
        if bodies.is_empty() {
            // Nothing usable at all — keep the currently compiled engine.
            return Ok(false);
        }
        let mut aggregate = String::new();
        for body in bodies {
            if aggregate.len().saturating_add(body.len() + 1) > MAX_COMBINED_FILTER_BYTES {
                return Ok(false);
            }
            aggregate.push_str(&body);
            aggregate.push('\n');
        }
        if aggregate.len() > MAX_COMBINED_FILTER_BYTES {
            return Ok(false);
        }

        let _cache_guard = self
            .cache_gate
            .lock()
            .map_err(|_| AppError::Internal("filter cache lock poisoned".into()))?;
        let current_cache = read_cache(&self.cache_path)?;
        if aggregate != current_cache {
            write_atomic(&self.cache_path, aggregate.as_bytes())?;
            self.replace_compiled(&aggregate);
        } else if !self.cache_is_loaded() {
            // The cache was already current, but this is the first time this
            // process has used it; activate it now so status remains truthful.
            self.replace_compiled(&aggregate);
        } else {
            self.cache_loaded.store(true, Ordering::Release);
        }
        drop(_cache_guard);
        settings::mark_filter_success(settings, etags)?;
        Ok(true)
    }

    fn replace_compiled(&self, cached: &str) {
        let compiled = compile_rules(include_str!("../../../shared/filters/default.txt"), cached);
        if let Ok(mut rules) = self.rules.write() {
            *rules = Arc::new(compiled);
            self.cache_loaded.store(true, Ordering::Release);
        }
    }
}

struct SourceFetch {
    body: Option<String>,
    etag: Option<(String, String)>,
}

/// Download a response with a hard byte limit. Checking Content-Length alone
/// is not sufficient because a server can omit it or send a larger body.
async fn read_limited_response(response: reqwest::Response) -> Option<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_FILTER_LIST_BYTES as u64)
    {
        return None;
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if bytes.len().saturating_add(chunk.len()) > MAX_FILTER_LIST_BYTES {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    (!bytes.is_empty()).then_some(bytes)
}

/// Download one filter list. A fresh, valid download replaces the on-disk
/// copy; anything else (304, HTTP error, timeout, invalid body) falls back
/// to that copy so a single bad host never poisons the other lists.
async fn fetch_one_source(
    client: &Client,
    source: &str,
    etag: Option<String>,
    path: &Path,
) -> SourceFetch {
    let cached = read_bounded(path, MAX_FILTER_LIST_BYTES).ok().flatten();
    let mut request = client.get(source);
    if cached.is_some() {
        if let Some(etag) = etag.as_deref() {
            request = request.header(header::IF_NONE_MATCH, etag);
        }
    }
    match request.send().await {
        Ok(response) if response.status() == StatusCode::NOT_MODIFIED => {}
        Ok(response) if response.status().is_success() => {
            let fresh_etag = response
                .headers()
                .get(header::ETAG)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            if let Some(bytes) = read_limited_response(response).await {
                if let Ok(text) = String::from_utf8(bytes) {
                    if has_usable_rule(&text) {
                        // Best effort: even if persisting fails, the
                        // in-memory text is still used for this session.
                        let _ = write_atomic(path, text.as_bytes());
                        return SourceFetch {
                            etag: fresh_etag.map(|value| (source.to_string(), value)),
                            body: Some(text),
                        };
                    }
                }
            }
        }
        Ok(_) | Err(_) => {}
    }
    SourceFetch {
        body: cached,
        etag: None,
    }
}

fn compile_rules(default_rules: &str, cached_rules: &str) -> CompiledRules {
    let default_text = bounded_filter_text(default_rules, MAX_COMBINED_FILTER_BYTES);
    let remaining = MAX_COMBINED_FILTER_BYTES.saturating_sub(default_text.len());
    let cached_text = bounded_filter_text(cached_rules, remaining);
    let mut filter_set = FilterSet::new(false);
    if !default_text.is_empty() {
        filter_set.add_filter_list(default_text.clone(), ParseOptions::default());
    }
    if !cached_text.is_empty() {
        filter_set.add_filter_list(cached_text.clone(), ParseOptions::default());
    }
    let rule_count = default_text
        .lines()
        .chain(cached_text.lines())
        .filter(|line| is_usable_rule(line))
        .count();
    CompiledRules {
        engine: Arc::new(Engine::new_with_filter_set(filter_set)),
        rule_count,
    }
}

fn bounded_filter_text(source: &str, max_bytes: usize) -> String {
    let mut result = String::new();
    for line in source.lines().take(MAX_FILTER_LINES) {
        if line.len() > MAX_FILTER_LINE_BYTES {
            continue;
        }
        if result.len().saturating_add(line.len() + 1) > max_bytes {
            break;
        }
        result.push_str(line);
        result.push('\n');
    }
    result
}

fn read_cache(path: &Path) -> AppResult<String> {
    Ok(read_bounded(path, MAX_COMBINED_FILTER_BYTES)?.unwrap_or_default())
}

fn read_bounded(path: &Path, max_bytes: usize) -> AppResult<Option<String>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > max_bytes as u64
    {
        return Ok(None);
    }
    let mut file = fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(metadata.len().min(max_bytes as u64) as usize);
    let mut limited = Read::by_ref(&mut file).take(max_bytes as u64 + 1);
    limited.read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Ok(None);
    }
    Ok(String::from_utf8(bytes).ok())
}

fn source_cache_path(source_cache_dir: &Path, source: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    source.hash(&mut hasher);
    source_cache_dir.join(format!("{:016x}.txt", hasher.finish()))
}

fn temporary_path(path: &Path) -> PathBuf {
    let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("tmp.{}.{sequence}", std::process::id()))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err(AppError::UnsafePath(
                "filter cache target is a symbolic link".into(),
            ));
        }
    }
    let _guard = FILTER_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::Storage("filter write lock poisoned".into()))?;
    let temporary = temporary_path(path);
    let result = (|| -> AppResult<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        settings::replace_file(&temporary, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn has_usable_rule(text: &str) -> bool {
    text.lines()
        .take(MAX_FILTER_LINES)
        .filter(|line| line.len() <= MAX_FILTER_LINE_BYTES)
        .any(is_usable_rule)
}

fn is_usable_rule(line: &str) -> bool {
    let line = line.trim();
    !line.is_empty() && !line.starts_with('!') && !line.starts_with('[')
}

fn is_tracking_url(raw: &str) -> bool {
    let Ok(parsed) = url::Url::parse(raw) else {
        return false;
    };
    let Some(host) = parsed.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    const TRACKING_HOSTS: &[&str] = &[
        "google-analytics.com",
        "googletagmanager.com",
        "analytics.google.com",
    ];
    if TRACKING_HOSTS
        .iter()
        .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
    {
        return true;
    }
    (host == "youtube.com" || host.ends_with(".youtube.com")) && parsed.path() == "/api/stats/qoe"
}

fn is_safe_selector(selector: &str) -> bool {
    !selector.is_empty()
        && selector.len() <= 2048
        && !selector.chars().any(|character| character.is_control())
        && !selector.contains(['{', '}', ';'])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn manager() -> FilterManager {
        manager_at(std::env::temp_dir().join(format!(
            "yood-filter-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos()
        )))
    }

    fn manager_at(path: PathBuf) -> FilterManager {
        FilterManager::new(path).expect("filter manager")
    }

    #[test]
    fn uses_brave_engine_network_syntax_and_exceptions() {
        let filter = manager();
        assert!(filter.matches_blocked("https://doubleclick.net/ad.js", false));
        let compiled = compile_rules(
            "||ads.example.test^$script\n@@ads.example.test/allowed.js",
            "",
        );
        assert!(compiled
            .engine
            .check_network_request(
                &Request::new(
                    "https://ads.example.test/ad.js",
                    "https://www.youtube.com/watch?v=test",
                    "script",
                    "GET"
                )
                .expect("request")
            )
            .should_block());
        assert!(!compiled
            .engine
            .check_network_request(
                &Request::new(
                    "https://ads.example.test/allowed.js",
                    "https://www.youtube.com/watch?v=test",
                    "script",
                    "GET"
                )
                .expect("request")
            )
            .should_block());
    }

    #[test]
    fn exposes_hostname_cosmetic_rules_for_the_active_page() {
        let filter = manager();
        let rules = filter.script_rules("https://www.youtube.com/watch?v=test", &[], &[]);
        assert!(rules
            .cosmetic_selectors
            .iter()
            .any(|selector| selector.contains("ytp-ad")));
        assert!(rules
            .cosmetic_selectors
            .iter()
            .any(|selector| selector.contains("promoted")));
    }

    #[test]
    fn builtin_rules_block_known_ad_hosts_but_never_content_cdn() {
        let filter = manager();
        for url in [
            "https://googleads.g.doubleclick.net/pagead/id",
            "https://tpc.googlesyndication.com/sodar/sodar2.js",
            "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
            "https://static.doubleclick.net/instream/ad_status.js",
            "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateChallenge",
            "https://www.youtube.com/ptracking?video_id=test",
        ] {
            assert!(filter.matches_blocked(url, false), "should block {url}");
        }
        // The content CDN and normal pages must never match: a false
        // positive here breaks playback instead of just hiding an ad.
        for url in [
            "https://rr1---sn-abc.googlevideo.com/videoplayback?expire=1&mn=sn-abc",
            "https://www.youtube.com/watch?v=test",
            "https://i.ytimg.com/vi/test/hqdefault.jpg",
        ] {
            assert!(!filter.matches_blocked(url, false), "must not block {url}");
        }
    }

    #[test]
    fn tracking_policy_is_explicit_and_reported() {
        let filter = manager();
        let url = "https://www.google-analytics.com/collect";
        assert!(!filter.matches_blocked(url, false));
        filter.set_tracking_protection(true);
        assert!(!filter.matches_blocked(url, false));
        assert!(filter.check_network_request(url, "https://www.youtube.com/", "other"));
        assert!(filter.check_network_request_with_policy(
            url,
            "https://www.youtube.com/",
            "other",
            true
        ));
        let status = filter.status(&Settings::default());
        assert!(status.tracking_supported);
        assert!(status.tracking_enabled);
        assert!(!status.aggressive_tracking_enabled);
    }

    #[test]
    fn remote_cache_is_loaded_lazily() {
        let path = std::env::temp_dir().join(format!(
            "yood-filter-lazy-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("filters.cache"), "||lazy.example.test^\n").unwrap();
        let filter = manager_at(path.clone());
        assert!(!filter.cache_is_loaded());
        assert!(filter.matches_blocked("https://lazy.example.test/ad.js", false));
        assert!(filter.cache_is_loaded());
        assert!(filter.status(&Settings::default()).cache_loaded);
        let _ = std::fs::remove_dir_all(path);
    }

    #[test]
    fn atomic_filter_write_replaces_existing_cache() {
        let path = std::env::temp_dir().join(format!(
            "yood-filter-atomic-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let cache = path.join("filters.cache");
        std::fs::write(&cache, b"old").unwrap();
        write_atomic(&cache, b"new").unwrap();
        assert_eq!(std::fs::read(&cache).unwrap(), b"new");
        let _ = std::fs::remove_dir_all(path);
    }
}
