use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufWriter, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
struct SaveRecord {
    id: String,
    folder_name: String,
    path: String,
    title: String,
    world: String,
    character_name: Option<String>,
    modified_at: u64,
    size_bytes: u64,
    file_count: u64,
    game_version: Option<String>,
    save_type: Option<String>,
    saved_time: Option<String>,
    accent: &'static str,
    metadata_found: bool,
    fingerprint: String,
}

#[derive(Clone, Debug)]
struct FileItem {
    rel_path: String,
    size: u64,
    mtime_ms: u64,
}

#[inline]
fn json_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}

#[inline]
fn json_opt_str(val: &Option<String>) -> String {
    match val {
        Some(s) => format!("\"{}\"", json_escape(s)),
        None => "null".to_string(),
    }
}

#[inline]
fn system_time_ms(st: SystemTime) -> u64 {
    st.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[inline]
fn accent_for(name: &str) -> &'static str {
    let mut hash: i32 = 0;
    for b in name.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(b as i32);
    }
    match (hash.unsigned_abs() as usize) % 3 {
        0 => "lavender",
        1 => "butter",
        _ => "blush",
    }
}

fn format_world_name(raw: Option<&str>) -> String {
    let Some(map_name) = raw else {
        return "Unknown world".to_string();
    };
    let trimmed = map_name.trim();
    if trimmed.is_empty() {
        return "Unknown world".to_string();
    }
    let without_suffix = if trimmed.len() > 4 && trimmed[trimmed.len() - 4..].eq_ignore_ascii_case("_map") {
        &trimmed[..trimmed.len() - 4]
    } else if trimmed.len() > 4 && trimmed[..4].eq_ignore_ascii_case("map_") {
        &trimmed[4..]
    } else {
        trimmed
    };

    let alpha_lower: String = without_suffix
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_lowercase())
        .collect();

    match alpha_lower.as_str() {
        "redcity" => return "Red City".to_string(),
        "blissbay" => return "Bliss Bay".to_string(),
        "dowon" => return "Dowon".to_string(),
        "cahaya" => return "Cahaya".to_string(),
        _ => {}
    }

    let mut spaced = String::new();
    let mut prev_lower_or_digit = false;
    for ch in without_suffix.chars() {
        if ch == '_' || ch == '-' {
            if !spaced.ends_with(' ') {
                spaced.push(' ');
            }
            prev_lower_or_digit = false;
        } else {
            if ch.is_ascii_uppercase() && prev_lower_or_digit && !spaced.ends_with(' ') {
                spaced.push(' ');
            }
            spaced.push(ch);
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }
    spaced.trim().to_string()
}

/// Fast byte-level JSON extractor that scans raw bytes before UTF-8 conversion
#[inline]
fn extract_json_block(buf: &[u8]) -> Option<String> {
    let start = buf.iter().position(|&b| b == b'{')?;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (offset, &b) in buf[start..].iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(String::from_utf8_lossy(&buf[start..=start + offset]).into_owned());
                }
            }
            _ => {}
        }
    }
    None
}

#[inline]
fn extract_json_field(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let pos = json.find(&pattern)?;
    let after_key = &json[pos + pattern.len()..];
    let colon = after_key.find(':')?;
    let rest = after_key[colon + 1..].trim_start();
    if let Some(stripped) = rest.strip_prefix('"') {
        let mut out = String::new();
        let mut escaped = false;
        for ch in stripped.chars() {
            if escaped {
                out.push(ch);
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                let trimmed = out.trim().to_string();
                return if trimmed.is_empty() { None } else { Some(trimmed) };
            } else {
                out.push(ch);
            }
        }
        None
    } else {
        let end = rest
            .find(|c: char| c == ',' || c == '\n' || c == '\r' || c == '}')
            .unwrap_or(rest.len());
        let token = rest[..end].trim();
        if token.is_empty() || token == "null" {
            None
        } else {
            Some(token.to_string())
        }
    }
}

fn find_metadata_file(folder: &Path, folder_name: &str) -> Option<PathBuf> {
    let direct = folder.join(format!("{}.usvx", folder_name));
    if direct.is_file() {
        return Some(direct);
    }
    let entries = fs::read_dir(folder).ok()?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("usvx") {
                    candidates.push(path);
                }
            }
        }
    }
    if candidates.is_empty() {
        return None;
    }
    candidates.sort();
    for cand in &candidates {
        let name = cand
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !name.contains("autosave") {
            return Some(cand.clone());
        }
    }
    candidates.into_iter().next()
}

fn stat_file_entries(entries: &[fs::DirEntry]) -> (u64, u64, u64, u64) {
    let mut size_bytes = 0u64;
    let mut file_count = 0u64;
    let mut latest_mtime = 0u64;
    let mut fnv: u64 = 0xcbf29ce484222325;
    for entry in entries {
        if let Ok(meta) = entry.metadata() {
            let sz = meta.len();
            let mtime = meta.modified().map(system_time_ms).unwrap_or(0);
            size_bytes += sz;
            file_count += 1;
            if mtime > latest_mtime {
                latest_mtime = mtime;
            }
            for &b in entry.file_name().as_encoded_bytes() {
                fnv ^= b as u64;
                fnv = fnv.wrapping_mul(0x100000001b3);
            }
            fnv ^= sz;
            fnv = fnv.wrapping_mul(0x100000001b3);
        }
    }
    (size_bytes, file_count, latest_mtime, fnv)
}

fn walk_subtree_stat(dir: &Path) -> (u64, u64, u64, u64) {
    let mut size_bytes = 0u64;
    let mut file_count = 0u64;
    let mut latest_mtime = 0u64;
    let mut fnv: u64 = 0xcbf29ce484222325;
    let mut stack = vec![dir.to_path_buf()];
    let mut file_entries: Vec<fs::DirEntry> = Vec::with_capacity(256);

    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name_bytes = file_name.as_encoded_bytes();
            if name_bytes.first() == Some(&b'.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(entry.path());
            } else if ft.is_file() {
                file_entries.push(entry);
            }
        }
    }

    if file_entries.len() >= 96 {
        let chunk_size = (file_entries.len() / 4).max(32);
        let parts: Vec<(u64, u64, u64, u64)> = thread::scope(|s| {
            let handles: Vec<_> = file_entries
                .chunks(chunk_size)
                .map(|chunk| s.spawn(move || stat_file_entries(chunk)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        for (sz, fc, mt, sub_fnv) in parts {
            size_bytes += sz;
            file_count += fc;
            if mt > latest_mtime {
                latest_mtime = mt;
            }
            fnv ^= sub_fnv;
            fnv = fnv.wrapping_mul(0x100000001b3);
        }
    } else {
        let (sz, fc, mt, sub_fnv) = stat_file_entries(&file_entries);
        size_bytes += sz;
        file_count += fc;
        if mt > latest_mtime {
            latest_mtime = mt;
        }
        fnv ^= sub_fnv;
        fnv = fnv.wrapping_mul(0x100000001b3);
    }

    (size_bytes, file_count, latest_mtime, fnv)
}

/// Multi-threaded save folder walker: splits top-level subdirectories across worker threads
fn walk_save_folder(folder: &Path) -> (u64, u64, u64, u64) {
    let Ok(entries) = fs::read_dir(folder) else {
        return (0, 0, 0, 0xcbf29ce484222325);
    };
    let mut size_bytes = 0u64;
    let mut file_count = 0u64;
    let mut latest_mtime = 0u64;
    let mut fnv: u64 = 0xcbf29ce484222325;
    let mut subdirs: Vec<PathBuf> = Vec::new();

    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name_bytes = file_name.as_encoded_bytes();
        if name_bytes.first() == Some(&b'.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            subdirs.push(entry.path());
        } else if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                let sz = meta.len();
                let mtime = meta.modified().map(system_time_ms).unwrap_or(0);
                size_bytes += sz;
                file_count += 1;
                if mtime > latest_mtime {
                    latest_mtime = mtime;
                }
                for &b in name_bytes {
                    fnv ^= b as u64;
                    fnv = fnv.wrapping_mul(0x100000001b3);
                }
                fnv ^= sz;
                fnv = fnv.wrapping_mul(0x100000001b3);
            }
        }
    }

    if subdirs.len() > 1 {
        let results: Vec<(u64, u64, u64, u64)> = thread::scope(|s| {
            let handles: Vec<_> = subdirs
                .iter()
                .map(|d| s.spawn(move || walk_subtree_stat(d)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        for (sz, fc, mt, sub_fnv) in results {
            size_bytes += sz;
            file_count += fc;
            if mt > latest_mtime {
                latest_mtime = mt;
            }
            fnv ^= sub_fnv;
            fnv = fnv.wrapping_mul(0x100000001b3);
        }
    } else if let Some(only_dir) = subdirs.first() {
        let (sz, fc, mt, sub_fnv) = walk_subtree_stat(only_dir);
        size_bytes += sz;
        file_count += fc;
        if mt > latest_mtime {
            latest_mtime = mt;
        }
        fnv ^= sub_fnv;
        fnv = fnv.wrapping_mul(0x100000001b3);
    }

    (size_bytes, file_count, latest_mtime, fnv)
}

fn scan_single_save(save_path: PathBuf, folder_name: String) -> Option<SaveRecord> {
    let folder_meta = fs::metadata(&save_path).ok()?;
    if !folder_meta.is_dir() {
        return None;
    }
    let folder_mtime = folder_meta.modified().map(system_time_ms).unwrap_or(0);
    let (size_bytes, file_count, latest_mtime, fnv) = walk_save_folder(&save_path);

    let mut json_block: Option<String> = None;
    if let Some(usvx_path) = find_metadata_file(&save_path, &folder_name) {
        if let Ok(mut file) = File::open(usvx_path) {
            // Stack-allocated 16 KB buffer: IZTB JSON header sits in the first ~1 KB
            let mut buf = [0u8; 16384];
            if let Ok(n) = file.read(&mut buf) {
                json_block = extract_json_block(&buf[..n]);
            }
        }
    }

    let first_name = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "CharacterFirstName"));
    let last_name = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "CharacterLastName"));
    let household = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "HouseholdName"))
        .or_else(|| {
            json_block
                .as_deref()
                .and_then(|j| extract_json_field(j, "FamilyName"))
        });
    let map_name = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "MapName"));
    let game_version = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "GameVersion"));
    let save_type = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "SaveType"));
    let saved_time = json_block
        .as_deref()
        .and_then(|j| extract_json_field(j, "SavedTime"));

    let character_name = match (&first_name, &last_name) {
        (Some(f), Some(l)) => Some(format!("{} {}", f, l)),
        (Some(f), None) => Some(f.clone()),
        (None, Some(l)) => Some(l.clone()),
        (None, None) => None,
    };

    let title = if let Some(h) = household {
        if h.to_ascii_lowercase().contains("household") {
            h
        } else {
            format!("The {} household", h)
        }
    } else if let Some(ref c) = character_name {
        c.clone()
    } else {
        folder_name.clone()
    };

    let modified_at = latest_mtime.max(folder_mtime);

    Some(SaveRecord {
        id: folder_name.clone(),
        folder_name: folder_name.clone(),
        path: save_path.to_string_lossy().to_string(),
        title,
        world: format_world_name(map_name.as_deref()),
        character_name,
        modified_at,
        size_bytes,
        file_count,
        game_version,
        save_type,
        saved_time,
        accent: accent_for(&folder_name),
        metadata_found: json_block.is_some(),
        fingerprint: format!("{:016x}", fnv),
    })
}

fn build_scan_json(root: &Path, req_id: Option<&str>) -> String {
    let started = Instant::now();
    let mut dirs: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if file_name.as_encoded_bytes().first() == Some(&b'.') {
                continue;
            }
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    dirs.push((entry.path(), file_name.to_string_lossy().into_owned()));
                }
            }
        }
    }

    let mut records: Vec<SaveRecord> = if dirs.len() <= 1 {
        dirs.into_iter()
            .filter_map(|(path, name)| scan_single_save(path, name))
            .collect()
    } else {
        thread::scope(|s| {
            let handles: Vec<_> = dirs
                .into_iter()
                .map(|(path, name)| s.spawn(move || scan_single_save(path, name)))
                .collect();
            handles
                .into_iter()
                .filter_map(|h| h.join().ok().flatten())
                .collect()
        })
    };

    records.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    let elapsed_us = started.elapsed().as_micros() as u64;

    let mut out = String::with_capacity(1024 + records.len() * 380);
    out.push('{');
    if let Some(id) = req_id {
        out.push_str(&format!("\"reqId\":\"{}\",", json_escape(id)));
    }
    out.push_str("\"engine\":\"rust-native\",\"durationUs\":");
    out.push_str(&elapsed_us.to_string());
    out.push_str(",\"saves\":[");
    for (idx, r) in records.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"id\":\"{}\",\"folderName\":\"{}\",\"path\":\"{}\",\"title\":\"{}\",\"world\":\"{}\",\"characterName\":{},\"modifiedAt\":{},\"sizeBytes\":{},\"fileCount\":{},\"gameVersion\":{},\"saveType\":{},\"savedTime\":{},\"accent\":\"{}\",\"metadataFound\":{},\"fingerprint\":\"{}\"}}",
            json_escape(&r.id),
            json_escape(&r.folder_name),
            json_escape(&r.path),
            json_escape(&r.title),
            json_escape(&r.world),
            json_opt_str(&r.character_name),
            r.modified_at,
            r.size_bytes,
            r.file_count,
            json_opt_str(&r.game_version),
            json_opt_str(&r.save_type),
            json_opt_str(&r.saved_time),
            r.accent,
            r.metadata_found,
            r.fingerprint
        ));
    }
    out.push_str("]}");
    out
}

fn stat_collect_entries(save_root: &Path, entries: &[fs::DirEntry]) -> Vec<FileItem> {
    let mut out = Vec::with_capacity(entries.len());
    for entry in entries {
        if let Ok(meta) = entry.metadata() {
            let full = entry.path();
            if let Ok(rel) = full.strip_prefix(save_root) {
                let rel_str = rel
                    .components()
                    .map(|c| c.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");
                out.push(FileItem {
                    rel_path: rel_str,
                    size: meta.len(),
                    mtime_ms: meta.modified().map(system_time_ms).unwrap_or(0),
                });
            }
        }
    }
    out
}

fn collect_subtree(save_root: &Path, sub: &Path) -> Vec<FileItem> {
    let mut file_entries: Vec<fs::DirEntry> = Vec::with_capacity(256);
    let mut stack = vec![sub.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if file_name.as_encoded_bytes().first() == Some(&b'.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                stack.push(entry.path());
            } else if ft.is_file() {
                file_entries.push(entry);
            }
        }
    }

    if file_entries.len() >= 96 {
        let chunk_size = (file_entries.len() / 4).max(32);
        let parts: Vec<Vec<FileItem>> = thread::scope(|s| {
            let handles: Vec<_> = file_entries
                .chunks(chunk_size)
                .map(|chunk| s.spawn(move || stat_collect_entries(save_root, chunk)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        let mut files = Vec::with_capacity(file_entries.len());
        for mut part in parts {
            files.append(&mut part);
        }
        files
    } else {
        stat_collect_entries(save_root, &file_entries)
    }
}

fn build_collect_json(save_root: &Path, req_id: Option<&str>) -> String {
    let started = Instant::now();
    let mut files: Vec<FileItem> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();

    if let Ok(entries) = fs::read_dir(save_root) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            if file_name.as_encoded_bytes().first() == Some(&b'.') {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_symlink() {
                continue;
            }
            let full = entry.path();
            if ft.is_dir() {
                subdirs.push(full);
            } else if ft.is_file() {
                if let Ok(meta) = entry.metadata() {
                    files.push(FileItem {
                        rel_path: file_name.to_string_lossy().into_owned(),
                        size: meta.len(),
                        mtime_ms: meta.modified().map(system_time_ms).unwrap_or(0),
                    });
                }
            }
        }
    }

    if subdirs.len() > 1 {
        let nested: Vec<Vec<FileItem>> = thread::scope(|s| {
            let handles: Vec<_> = subdirs
                .iter()
                .map(|d| s.spawn(move || collect_subtree(save_root, d)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        for mut list in nested {
            files.append(&mut list);
        }
    } else if let Some(only) = subdirs.first() {
        files.append(&mut collect_subtree(save_root, only));
    }

    files.sort_unstable_by(|a, b| a.rel_path.cmp(&b.rel_path));
    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let file_count = files.len();
    let elapsed_us = started.elapsed().as_micros() as u64;

    let mut out = String::with_capacity(512 + file_count * 96);
    out.push('{');
    if let Some(id) = req_id {
        out.push_str(&format!("\"reqId\":\"{}\",", json_escape(id)));
    }
    out.push_str(&format!(
        "\"engine\":\"rust-native\",\"durationUs\":{},\"totalBytes\":{},\"fileCount\":{},\"files\":[",
        elapsed_us, total_bytes, file_count
    ));
    for (idx, f) in files.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "{{\"path\":\"{}\",\"size\":{},\"mtimeMs\":{}}}",
            json_escape(&f.rel_path),
            f.size,
            f.mtime_ms
        ));
    }
    out.push_str("]}");
    out
}

fn build_probe_json(host: &str, port: u16, timeout_ms: u64, req_id: Option<&str>) -> String {
    let prefix = match req_id {
        Some(id) => format!("{{\"reqId\":\"{}\",", json_escape(id)),
        None => "{".to_string(),
    };
    let target = format!("{}:{}", host, port);
    let Ok(mut addrs) = target.to_socket_addrs() else {
        return format!("{}\"reachable\":false,\"error\":\"DNS resolution failed\"}}", prefix);
    };
    let Some(addr): Option<SocketAddr> = addrs.find(|a| a.is_ipv4()).or_else(|| {
        target
            .to_socket_addrs()
            .ok()
            .and_then(|mut it| it.next())
    }) else {
        return format!("{}\"reachable\":false,\"error\":\"No socket address\"}}", prefix);
    };

    let timeout = Duration::from_millis(timeout_ms);
    let started = Instant::now();
    let stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(e) => {
            return format!(
                "{}\"reachable\":false,\"error\":\"{}\"}}",
                prefix,
                json_escape(&e.to_string())
            );
        }
    };
    let rtt_us = started.elapsed().as_micros() as u64;
    let rtt_ms = (rtt_us as f64) / 1000.0;
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    let mut stream = stream;
    let req = format!(
        "GET /api/info HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\nAccept: application/json\r\n\r\n",
        host, port
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return format!(
            "{}\"reachable\":true,\"rttMs\":{:.2},\"info\":null}}",
            prefix, rtt_ms
        );
    }

    let mut resp = Vec::with_capacity(4096);
    let _ = stream.read_to_end(&mut resp);
    let body = resp
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .and_then(|idx| extract_json_block(&resp[idx + 4..]));

    match body {
        Some(json_info) => {
            format!(
                "{}\"reachable\":true,\"rttMs\":{:.2},\"info\":{}}}",
                prefix, rtt_ms, json_info
            )
        }
        None => {
            format!(
                "{}\"reachable\":true,\"rttMs\":{:.2},\"info\":null}}",
                prefix, rtt_ms
            )
        }
    }
}

fn quick_folder_signature(root: &Path) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    let Ok(root_meta) = fs::metadata(root) else {
        return 0;
    };
    let root_mt = root_meta.modified().map(system_time_ms).unwrap_or(0);
    hash ^= root_mt;
    hash = hash.wrapping_mul(0x100000001b3);

    let Ok(entries) = fs::read_dir(root) else {
        return hash;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let bytes = name.as_encoded_bytes();
        if bytes.first() == Some(&b'.') {
            continue;
        }
        for &b in bytes {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        if let Ok(meta) = entry.metadata() {
            let mt = meta.modified().map(system_time_ms).unwrap_or(0);
            hash ^= mt ^ meta.len();
            hash = hash.wrapping_mul(0x100000001b3);
            if meta.is_dir() {
                let p = entry.path();
                let folder_str = name.to_string_lossy();
                let usvx = p.join(format!("{}.usvx", folder_str));
                if let Ok(um) = fs::metadata(&usvx) {
                    let umt = um.modified().map(system_time_ms).unwrap_or(0);
                    hash ^= umt ^ um.len();
                    hash = hash.wrapping_mul(0x100000001b3);
                }
                let portrait = p.join(&*folder_str).join("Portrait");
                if let Ok(pm) = fs::metadata(&portrait) {
                    let pmt = pm.modified().map(system_time_ms).unwrap_or(0);
                    hash ^= pmt;
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
        }
    }
    hash
}

fn replace_req_id_and_duration(cached_json: &str, req_id: Option<&str>, elapsed_us: u64) -> String {
    if let Some(pos) = cached_json.find(",\"saves\":[") {
        let tail = &cached_json[pos..];
        return match req_id {
            Some(id) => format!(
                "{{\"reqId\":\"{}\",\"engine\":\"rust-native\",\"durationUs\":{}{}",
                json_escape(id),
                elapsed_us,
                tail
            ),
            None => format!(
                "{{\"engine\":\"rust-native\",\"durationUs\":{}{}",
                elapsed_us, tail
            ),
        };
    }
    if let Some(pos) = cached_json.find(",\"totalBytes\":") {
        let tail = &cached_json[pos..];
        return match req_id {
            Some(id) => format!(
                "{{\"reqId\":\"{}\",\"engine\":\"rust-native\",\"durationUs\":{}{}",
                json_escape(id),
                elapsed_us,
                tail
            ),
            None => format!(
                "{{\"engine\":\"rust-native\",\"durationUs\":{}{}",
                elapsed_us, tail
            ),
        };
    }
    cached_json.to_string()
}

fn run_daemon() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut writer = BufWriter::new(stdout.lock());
    let mut scan_cache: HashMap<String, (u64, String)> = HashMap::new();
    let mut collect_cache: HashMap<String, (u64, String)> = HashMap::new();

    for line in stdin.lock().lines() {
        let Ok(raw) = line else {
            break;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        let cmd = parts.first().copied().unwrap_or("");
        let req_id = parts.get(1).copied();

        let response = match cmd {
            "SCAN" => {
                let path_str = parts.get(2).copied().unwrap_or("");
                let path = Path::new(path_str);
                let t0 = Instant::now();
                let sig = quick_folder_signature(path);
                if sig != 0 {
                    if let Some((cached_sig, cached_json)) = scan_cache.get(path_str) {
                        if *cached_sig == sig {
                            let us = t0.elapsed().as_micros().max(1) as u64;
                            let resp = replace_req_id_and_duration(cached_json, req_id, us);
                            let _ = writer.write_all(resp.as_bytes());
                            let _ = writer.write_all(b"\n");
                            let _ = writer.flush();
                            continue;
                        }
                    }
                }
                let built = build_scan_json(path, req_id);
                if sig != 0 {
                    scan_cache.insert(path_str.to_string(), (sig, built.clone()));
                }
                built
            }
            "COLLECT" => {
                let path_str = parts.get(2).copied().unwrap_or("");
                let path = Path::new(path_str);
                let t0 = Instant::now();
                let sig = quick_folder_signature(path);
                if sig != 0 {
                    if let Some((cached_sig, cached_json)) = collect_cache.get(path_str) {
                        if *cached_sig == sig {
                            let us = t0.elapsed().as_micros().max(1) as u64;
                            let resp = replace_req_id_and_duration(cached_json, req_id, us);
                            let _ = writer.write_all(resp.as_bytes());
                            let _ = writer.write_all(b"\n");
                            let _ = writer.flush();
                            continue;
                        }
                    }
                }
                let built = build_collect_json(path, req_id);
                if sig != 0 {
                    collect_cache.insert(path_str.to_string(), (sig, built.clone()));
                }
                built
            }
            "PROBE" => {
                let host = parts.get(2).copied().unwrap_or("127.0.0.1");
                let port: u16 = parts.get(3).and_then(|p| p.parse().ok()).unwrap_or(47772);
                let timeout_ms: u64 = parts.get(4).and_then(|t| t.parse().ok()).unwrap_or(2000);
                build_probe_json(host, port, timeout_ms, req_id)
            }
            "PING" => {
                format!(
                    "{{\"reqId\":\"{}\",\"ok\":true,\"engine\":\"rust-native\"}}",
                    json_escape(req_id.unwrap_or("0"))
                )
            }
            "QUIT" => break,
            _ => {
                format!(
                    "{{\"reqId\":\"{}\",\"error\":\"unknown command\"}}",
                    json_escape(req_id.unwrap_or("0"))
                )
            }
        };

        let _ = writer.write_all(response.as_bytes());
        let _ = writer.write_all(b"\n");
        let _ = writer.flush();
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: inzoi-core <daemon|scan|collect|probe> [args...]");
        std::process::exit(1);
    }
    match args[1].as_str() {
        "daemon" => {
            run_daemon();
        }
        "scan" => {
            let Some(path) = args.get(2) else {
                eprintln!("Missing path for scan");
                std::process::exit(1);
            };
            println!("{}", build_scan_json(Path::new(path), None));
        }
        "collect" => {
            let Some(path) = args.get(2) else {
                eprintln!("Missing path for collect");
                std::process::exit(1);
            };
            println!("{}", build_collect_json(Path::new(path), None));
        }
        "probe" => {
            let host = args.get(2).map(|s| s.as_str()).unwrap_or("127.0.0.1");
            let port: u16 = args
                .get(3)
                .and_then(|p| p.parse().ok())
                .unwrap_or(47772);
            let timeout_ms: u64 = args
                .get(4)
                .and_then(|t| t.parse().ok())
                .unwrap_or(2500);
            println!("{}", build_probe_json(host, port, timeout_ms, None));
        }
        "--version" | "version" => {
            println!("{{\"engine\":\"rust-native\",\"version\":\"1.1.0\"}}");
        }
        _ => {
            eprintln!("Unknown command: {}", args[1]);
            std::process::exit(1);
        }
    }
}
