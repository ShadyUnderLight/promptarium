//! Markdown prompt storage, optional YAML frontmatter, and safe filesystem CRUD.
//! Prompt variables remain a frontend concern; Rust never parses them.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Value as YamlValue};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PromptStatus {
    Draft,
    Active,
    Archived,
}

impl Default for PromptStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptMetadata {
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub status: PromptStatus,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, JsonValue>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSummary {
    pub project_path: String,
    pub relative_path: String,
    pub name: String,
    pub folder: String,
    pub extension: String,
    pub metadata: PromptMetadata,
    pub modified_at: u64,
    pub size_bytes: u64,
    pub has_frontmatter: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDocument {
    #[serde(flatten)]
    pub summary: PromptSummary,
    pub body: String,
    pub raw: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontmatter_prefix: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedPrompt {
    metadata: PromptMetadata,
    body: String,
    has_frontmatter: bool,
    frontmatter_error: Option<String>,
    frontmatter_prefix: Option<String>,
}

fn line_end(text: &str, start: usize) -> usize {
    text[start..]
        .find('\n')
        .map(|offset| start + offset + 1)
        .unwrap_or(text.len())
}

fn line_without_eol(line: &str) -> &str {
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line)
}

fn split_frontmatter(raw: &str) -> Option<(String, String, String)> {
    if raw.is_empty() {
        return None;
    }
    let opening_end = line_end(raw, 0);
    if line_without_eol(&raw[..opening_end]) != "---" {
        return None;
    }
    let mut cursor = opening_end;
    while cursor < raw.len() {
        let end = line_end(raw, cursor);
        if matches!(line_without_eol(&raw[cursor..end]), "---" | "...") {
            return Some((
                raw[..end].to_string(),
                raw[opening_end..cursor].to_string(),
                raw[end..].to_string(),
            ));
        }
        cursor = end;
    }
    None
}

fn json_from_yaml(value: &YamlValue) -> Result<JsonValue, String> {
    serde_json::to_value(value).map_err(|e| format!("unknown metadata cannot be retained: {e}"))
}

fn string_list(value: &YamlValue, field: &str, errors: &mut Vec<String>) -> Vec<String> {
    let Some(values) = value.as_sequence() else {
        errors.push(format!("{field} must be a list of strings"));
        return Vec::new();
    };
    let mut output = Vec::with_capacity(values.len());
    for item in values {
        if let Some(text) = item.as_str() {
            output.push(text.to_string());
        } else {
            errors.push(format!("{field} must contain only strings"));
        }
    }
    output
}

fn valid_created_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn parse_metadata(yaml: &str) -> Result<(PromptMetadata, Option<String>), String> {
    let value: YamlValue = serde_yaml::from_str(yaml).map_err(|e| e.to_string())?;
    if value.is_null() {
        return Ok((PromptMetadata::default(), None));
    }
    let Some(mapping) = value.as_mapping() else {
        return Err("frontmatter must be a YAML mapping".to_string());
    };
    let mut metadata = PromptMetadata::default();
    let mut errors = Vec::new();
    for (key, value) in mapping {
        let Some(key) = key.as_str() else {
            errors.push("frontmatter keys must be strings".to_string());
            continue;
        };
        match key {
            "description" => match value.as_str() {
                Some(text) => metadata.description = text.to_string(),
                None => errors.push("description must be a string".to_string()),
            },
            "tags" => metadata.tags = string_list(value, "tags", &mut errors),
            "status" => match value.as_str() {
                Some("draft") => metadata.status = PromptStatus::Draft,
                Some("active") => metadata.status = PromptStatus::Active,
                Some("archived") => metadata.status = PromptStatus::Archived,
                Some(other) => errors.push(format!(
                    "status must be draft, active or archived (got {other:?})"
                )),
                None => errors.push("status must be a string".to_string()),
            },
            "favorite" => match value.as_bool() {
                Some(value) => metadata.favorite = value,
                None => errors.push("favorite must be a boolean".to_string()),
            },
            "models" => metadata.models = string_list(value, "models", &mut errors),
            "created" => match value.as_str() {
                Some(date) if valid_created_date(date) => metadata.created = Some(date.to_string()),
                Some(_) | None => errors.push("created must be a YYYY-MM-DD string".to_string()),
            },
            unknown => match json_from_yaml(value) {
                Ok(value) => {
                    metadata.extra.insert(unknown.to_string(), value);
                }
                Err(error) => errors.push(error),
            },
        }
    }
    Ok((metadata, (!errors.is_empty()).then(|| errors.join("; "))))
}

fn parse_content(raw: &str) -> ParsedPrompt {
    let Some((prefix, yaml, body)) = split_frontmatter(raw) else {
        let opening_end = line_end(raw, 0);
        if line_without_eol(&raw[..opening_end]) == "---" {
            return ParsedPrompt {
                metadata: PromptMetadata::default(),
                body: raw.to_string(),
                has_frontmatter: true,
                frontmatter_error: Some(
                    "frontmatter starts with --- but has no closing delimiter".to_string(),
                ),
                frontmatter_prefix: None,
            };
        }
        return ParsedPrompt {
            metadata: PromptMetadata::default(),
            body: raw.to_string(),
            has_frontmatter: false,
            frontmatter_error: None,
            frontmatter_prefix: None,
        };
    };
    match parse_metadata(&yaml) {
        Ok((metadata, error)) => ParsedPrompt {
            metadata,
            body,
            has_frontmatter: true,
            frontmatter_error: error,
            frontmatter_prefix: Some(prefix),
        },
        Err(error) => ParsedPrompt {
            metadata: PromptMetadata::default(),
            body,
            has_frontmatter: true,
            frontmatter_error: Some(error),
            frontmatter_prefix: Some(prefix),
        },
    }
}

fn modified_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn summary(project: &Path, path: &Path, raw: &str) -> Option<(PromptSummary, ParsedPrompt)> {
    let relative = path.strip_prefix(project).ok()?;
    let file_name = relative.file_name()?.to_str()?;
    let extension = relative.extension()?.to_str()?;
    if !extension.eq_ignore_ascii_case("md") {
        return None;
    }
    let stem = file_name.get(..file_name.len().checked_sub(extension.len() + 1)?)?;
    let parent = relative
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty());
    let name = parent
        .map(|parent| format!("{}/{}", parent.to_string_lossy().replace('\\', "/"), stem))
        .unwrap_or_else(|| stem.to_string());
    let folder = name
        .rsplit_once('/')
        .map(|(folder, _)| folder.to_string())
        .unwrap_or_default();
    let parsed = parse_content(raw);
    let result = PromptSummary {
        project_path: project.display().to_string(),
        relative_path: relative.to_string_lossy().replace('\\', "/"),
        name,
        folder,
        extension: ".md".to_string(),
        metadata: parsed.metadata.clone(),
        modified_at: modified_at(path),
        size_bytes: file_size(path),
        has_frontmatter: parsed.has_frontmatter,
        frontmatter_error: parsed.frontmatter_error.clone(),
    };
    Some((result, parsed))
}

pub(crate) fn project_root(project: &Path) -> Result<PathBuf, String> {
    if !project.exists() {
        return Err(format!("project folder not found: {}", project.display()));
    }
    if !project.is_dir() {
        return Err(format!(
            "project path is not a folder: {}",
            project.display()
        ));
    }
    project
        .canonicalize()
        .map_err(|e| format!("{}: {e}", project.display()))
}

pub fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("path cannot be empty".to_string());
    }
    if name.starts_with('/') {
        return Err(format!("path must be relative, not absolute: {name}"));
    }
    if name.contains('\\') || name.contains(':') || name.contains('\0') {
        return Err(format!("path may not contain '\\\\', ':' or NUL: {name}"));
    }
    for segment in name.split('/') {
        if segment.is_empty() {
            return Err(format!("path has an empty segment: {name}"));
        }
        if segment == "." || segment == ".." {
            return Err(format!("path may not contain '.' or '..' segments: {name}"));
        }
    }
    Ok(())
}

fn safe_relative_path(
    project: &Path,
    relative: &str,
    extension: Option<&str>,
) -> Result<PathBuf, String> {
    validate_name(relative)?;
    let root = project_root(project)?;
    let joined = match extension {
        Some(extension) => root.join(format!("{relative}{extension}")),
        None => root.join(relative),
    };
    if joined
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
        || !joined.starts_with(&root)
    {
        return Err(format!("path escapes the project folder: {relative}"));
    }
    let mut current = root.clone();
    for segment in relative.split('/') {
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("path traverses a symlink: {relative}"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    match fs::symlink_metadata(&joined) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!("path ends in a symlink: {relative}"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(joined)
}

fn prompt_path(project: &Path, name: &str) -> Result<PathBuf, String> {
    safe_relative_path(project, name, Some(".md"))
}

pub fn prompt_absolute_path(project: &Path, name: &str) -> Result<PathBuf, String> {
    prompt_path(project, name)
}

fn parse_prompt(project: &Path, path: &Path) -> Result<PromptDocument, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let Some((summary, parsed)) = summary(project, path, &raw) else {
        return Err(format!("not a Markdown prompt: {}", path.display()));
    };
    Ok(PromptDocument {
        summary,
        body: parsed.body,
        raw,
        frontmatter_prefix: parsed.frontmatter_prefix,
    })
}

fn collect(project: &Path, dir: &Path, out: &mut Vec<PromptSummary>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!(
                    "[prompts] skipping unreadable directory entry in {}: {error}",
                    dir.display()
                );
                continue;
            }
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect(project, &path, out)?;
        } else if file_type.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            match fs::read_to_string(&path) {
                Ok(raw) => {
                    if let Some((summary, _)) = summary(project, &path, &raw) {
                        out.push(summary);
                    }
                }
                Err(error) => eprintln!("[prompts] skipping {}: {error}", path.display()),
            }
        }
    }
    Ok(())
}

pub fn scan_prompts(project: &Path) -> Result<Vec<PromptSummary>, String> {
    let root = project_root(project)?;
    let mut prompts = Vec::new();
    collect(&root, &root, &mut prompts)?;
    prompts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(prompts)
}

fn collect_folders(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!(
                    "[prompts] skipping unreadable directory entry in {}: {error}",
                    dir.display()
                );
                continue;
            }
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if let Ok(relative) = path.strip_prefix(root) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
            collect_folders(root, &path, out)?;
        }
    }
    Ok(())
}

pub fn scan_folders(project: &Path) -> Result<Vec<String>, String> {
    let root = project_root(project)?;
    let mut folders = Vec::new();
    collect_folders(&root, &root, &mut folders)?;
    folders.sort();
    Ok(folders)
}

pub fn read_prompt(project: &Path, name: &str) -> Result<PromptDocument, String> {
    let root = project_root(project)?;
    let path = prompt_path(&root, name)?;
    if !path.is_file() {
        return Err(format!("prompt file not found: {}", path.display()));
    }
    parse_prompt(&root, &path)
}

fn metadata_has_values(metadata: &PromptMetadata) -> bool {
    !metadata.description.is_empty()
        || !metadata.tags.is_empty()
        || metadata.status != PromptStatus::Active
        || metadata.favorite
        || !metadata.models.is_empty()
        || metadata.created.is_some()
        || !metadata.extra.is_empty()
}

fn yaml_string(value: &str) -> YamlValue {
    YamlValue::String(value.to_string())
}

fn yaml_from_json(value: &JsonValue) -> Result<YamlValue, String> {
    serde_yaml::to_value(value).map_err(|e| e.to_string())
}

fn serialize_frontmatter(
    metadata: &PromptMetadata,
    include_default_status: bool,
) -> Result<String, String> {
    let mut mapping = Mapping::new();
    if !metadata.description.is_empty() {
        mapping.insert(
            yaml_string("description"),
            yaml_string(&metadata.description),
        );
    }
    if !metadata.tags.is_empty() {
        mapping.insert(
            yaml_string("tags"),
            YamlValue::Sequence(metadata.tags.iter().map(|tag| yaml_string(tag)).collect()),
        );
    }
    if include_default_status || metadata.status != PromptStatus::Active {
        let status = match metadata.status {
            PromptStatus::Draft => "draft",
            PromptStatus::Active => "active",
            PromptStatus::Archived => "archived",
        };
        mapping.insert(yaml_string("status"), yaml_string(status));
    }
    if metadata.favorite {
        mapping.insert(yaml_string("favorite"), YamlValue::Bool(true));
    }
    if !metadata.models.is_empty() {
        mapping.insert(
            yaml_string("models"),
            YamlValue::Sequence(
                metadata
                    .models
                    .iter()
                    .map(|model| yaml_string(model))
                    .collect(),
            ),
        );
    }
    if let Some(created) = &metadata.created {
        mapping.insert(yaml_string("created"), yaml_string(created));
    }
    for (key, value) in &metadata.extra {
        mapping.insert(yaml_string(key), yaml_from_json(value)?);
    }
    let mut yaml = serde_yaml::to_string(&mapping).map_err(|e| e.to_string())?;
    if !yaml.ends_with('\n') {
        yaml.push('\n');
    }
    Ok(format!("---\n{yaml}---\n"))
}

fn content_for_save(
    body: &str,
    metadata: &PromptMetadata,
    frontmatter_prefix: Option<&str>,
    metadata_dirty: bool,
) -> Result<String, String> {
    if !metadata_dirty {
        if let Some(prefix) = frontmatter_prefix {
            let separator = if prefix.ends_with('\n') { "" } else { "\n" };
            return Ok(format!("{prefix}{separator}{body}"));
        }
        if !metadata_has_values(metadata) {
            return Ok(body.to_string());
        }
    }
    if metadata_has_values(metadata) || metadata_dirty {
        return Ok(format!(
            "{}{body}",
            serialize_frontmatter(metadata, metadata_dirty)?
        ));
    }
    Ok(body.to_string())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "prompt has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    let tmp_name = format!(
        ".promptarium-tmp-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let tmp = parent.join(tmp_name);
    if let Err(error) = fs::write(&tmp, content) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {error}", path.display()));
    }
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {error}", path.display()));
    }
    Ok(())
}

pub fn create_prompt(
    project: &Path,
    name: &str,
    body: &str,
    metadata: &PromptMetadata,
) -> Result<PromptDocument, String> {
    let root = project_root(project)?;
    let path = prompt_path(&root, name)?;
    if path.exists() {
        return Err(format!("prompt already exists: {name}"));
    }
    let content = content_for_save(body, metadata, None, false)?;
    atomic_write(&path, &content)?;
    parse_prompt(&root, &path)
}

pub fn save_prompt(
    project: &Path,
    name: &str,
    body: &str,
    metadata: &PromptMetadata,
    frontmatter_prefix: Option<&str>,
    metadata_dirty: bool,
    expected_raw: Option<&str>,
) -> Result<PromptDocument, String> {
    let root = project_root(project)?;
    let path = prompt_path(&root, name)?;
    if let Some(expected) = expected_raw {
        let actual = fs::read_to_string(&path)
            .map_err(|e| format!("cannot check prompt before save: {}: {e}", path.display()))?;
        if actual != expected {
            return Err(format!(
                "PROMPT_CONFLICT: {} changed on disk while you were editing it",
                path.display()
            ));
        }
    }
    let content = content_for_save(body, metadata, frontmatter_prefix, metadata_dirty)?;
    atomic_write(&path, &content)?;
    parse_prompt(&root, &path)
}

pub fn rename_prompt(project: &Path, name: &str, new_name: &str) -> Result<PromptDocument, String> {
    let root = project_root(project)?;
    let source = prompt_path(&root, name)?;
    let target = prompt_path(&root, new_name)?;
    if source == target {
        return parse_prompt(&root, &source);
    }
    if !source.is_file() {
        return Err(format!("prompt file not found: {}", source.display()));
    }
    if target.exists() {
        return Err(format!("prompt already exists: {new_name}"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::rename(&source, &target).map_err(|e| format!("cannot rename prompt: {e}"))?;
    parse_prompt(&root, &target)
}

pub fn move_prompt(
    project: &Path,
    name: &str,
    destination: &str,
) -> Result<PromptDocument, String> {
    rename_prompt(project, name, destination)
}

pub fn delete_prompt(project: &Path, name: &str) -> Result<(), String> {
    let root = project_root(project)?;
    let path = prompt_path(&root, name)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot delete {}: {error}", path.display())),
    }
}

pub fn create_folder(project: &Path, folder: &str) -> Result<(), String> {
    let root = project_root(project)?;
    let path = safe_relative_path(&root, folder, None)?;
    if path.exists() && !path.is_dir() {
        return Err(format!("a file already exists at folder path: {folder}"));
    }
    fs::create_dir_all(&path).map_err(|e| format!("cannot create folder {folder}: {e}"))
}

pub fn rename_folder(project: &Path, folder: &str, new_folder: &str) -> Result<(), String> {
    let root = project_root(project)?;
    let source = safe_relative_path(&root, folder, None)?;
    let target = safe_relative_path(&root, new_folder, None)?;
    if source == target {
        return Ok(());
    }
    if !source.is_dir() {
        return Err(format!("folder not found: {folder}"));
    }
    if target.starts_with(&source) {
        return Err("cannot move a folder inside itself".to_string());
    }
    if target.exists() {
        return Err(format!("folder already exists: {new_folder}"));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    fs::rename(source, target).map_err(|e| format!("cannot rename folder: {e}"))
}

pub fn delete_empty_folder(project: &Path, folder: &str) -> Result<(), String> {
    let root = project_root(project)?;
    let path = safe_relative_path(&root, folder, None)?;
    match fs::remove_dir(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
            Err(format!("folder is not empty: {folder}"))
        }
        Err(error) => Err(format!("cannot delete folder {folder}: {error}")),
    }
}

fn field_score(token: &str, value: &str, weight: f32) -> Option<f32> {
    let value = value.to_lowercase();
    if !value.contains(token) {
        return None;
    }
    let mut score = weight;
    if value == token {
        score += weight;
    } else if value.starts_with(token) {
        score += weight * 0.55;
    } else if value
        .split(|character: char| !character.is_alphanumeric())
        .any(|word| word == token)
    {
        score += weight * 0.35;
    }
    Some(score)
}

pub fn search_prompts(project: &Path, query: &str) -> Result<Vec<PromptSummary>, String> {
    let root = project_root(project)?;
    let mut docs = Vec::new();
    collect_search(&root, &root, &mut docs)?;
    let tokens: Vec<String> = query
        .split_whitespace()
        .map(|token| token.to_lowercase())
        .collect();
    if tokens.is_empty() {
        return Ok(docs.into_iter().map(|(summary, _)| summary).collect());
    }
    let mut scored = Vec::new();
    for (summary, parsed) in docs {
        let tags = summary.metadata.tags.join(" ");
        let models = summary.metadata.models.join(" ");
        let mut total = 0.0;
        let mut matched = true;
        for token in &tokens {
            let best = [
                field_score(token, &summary.name, 100.0),
                field_score(token, &summary.relative_path, 95.0),
                field_score(token, &tags, 60.0),
                field_score(token, &summary.metadata.description, 45.0),
                field_score(token, &models, 35.0),
                field_score(token, &parsed.body, 20.0),
            ]
            .into_iter()
            .flatten()
            .fold(0.0, f32::max);
            if best == 0.0 {
                matched = false;
                break;
            }
            total += best;
        }
        if matched {
            scored.push((total / tokens.len() as f32, summary));
        }
    }
    scored.sort_by(|(a_score, a), (b_score, b)| {
        b_score
            .partial_cmp(a_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.name.cmp(&b.name))
    });
    Ok(scored.into_iter().map(|(_, summary)| summary).collect())
}

fn collect_search(
    project: &Path,
    dir: &Path,
    out: &mut Vec<(PromptSummary, ParsedPrompt)>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                eprintln!(
                    "[prompts] skipping unreadable directory entry in {}: {error}",
                    dir.display()
                );
                continue;
            }
        };
        let path = entry.path();
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            collect_search(project, &path, out)?;
        } else if file_type.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            match fs::read_to_string(&path) {
                Ok(raw) => {
                    if let Some((summary, parsed)) = summary(project, &path, &raw) {
                        out.push((summary, parsed));
                    }
                }
                Err(error) => eprintln!("[prompts] skipping {}: {error}", path.display()),
            }
        }
    }
    out.sort_by(|(a, _), (b, _)| a.name.cmp(&b.name));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "promptarium-library-test-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    #[test]
    fn plain_markdown_uses_defaults_and_preserves_the_whole_body() {
        let dir = tmp_dir("plain");
        write(
            &dir,
            "coding/review.md",
            "# Review\n\nKeep {repository} unchanged.\n---\n",
        );
        let prompts = scan_prompts(&dir).unwrap();
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].name, "coding/review");
        assert_eq!(prompts[0].folder, "coding");
        assert!(prompts[0].size_bytes > 0);
        assert!(!prompts[0].has_frontmatter);
        let document = read_prompt(&dir, "coding/review").unwrap();
        assert_eq!(
            document.body,
            "# Review\n\nKeep {repository} unchanged.\n---\n"
        );
        assert_eq!(document.raw, document.body);
        assert_eq!(document.summary.metadata, PromptMetadata::default());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn valid_frontmatter_parses_supported_and_unknown_fields() {
        let dir = tmp_dir("metadata");
        write(
            &dir,
            "review.md",
            "---\r\ndescription: Check regressions\r\ntags:\r\n  - coding\r\n  - review\r\nstatus: draft\r\nfavorite: true\r\nmodels:\r\n  - ChatGPT\r\ncreated: 2026-08-28\r\nowner: lmz\r\n---\r\n\r\nBody {ticket}\r\n",
        );
        let document = read_prompt(&dir, "review").unwrap();
        assert_eq!(document.summary.metadata.description, "Check regressions");
        assert_eq!(document.summary.metadata.tags, ["coding", "review"]);
        assert_eq!(document.summary.metadata.status, PromptStatus::Draft);
        assert!(document.summary.metadata.favorite);
        assert_eq!(document.summary.metadata.models, ["ChatGPT"]);
        assert_eq!(
            document.summary.metadata.created.as_deref(),
            Some("2026-08-28")
        );
        assert_eq!(
            document.summary.metadata.extra["owner"],
            JsonValue::String("lmz".into())
        );
        assert_eq!(document.body, "\r\nBody {ticket}\r\n");
        assert!(document.frontmatter_prefix.unwrap().contains("\r\n"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn empty_frontmatter_uses_defaults_without_a_warning() {
        let dir = tmp_dir("empty-metadata");
        write(&dir, "empty.md", "---\n---\nbody");
        let document = read_prompt(&dir, "empty").unwrap();
        assert!(document.summary.has_frontmatter);
        assert!(document.summary.frontmatter_error.is_none());
        assert_eq!(document.summary.metadata, PromptMetadata::default());
        assert_eq!(document.body, "body");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_created_date_stays_visible_with_a_warning() {
        let dir = tmp_dir("invalid-date");
        write(&dir, "date.md", "---\ncreated: tomorrow\n---\nbody");
        let document = read_prompt(&dir, "date").unwrap();
        assert!(document.summary.frontmatter_error.is_some());
        assert_eq!(document.summary.metadata.created, None);
        assert_eq!(document.body, "body");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn malformed_frontmatter_stays_visible_with_a_warning() {
        let dir = tmp_dir("invalid");
        write(&dir, "broken.md", "---\ndescription: [not valid\n---\nbody");
        let prompt = scan_prompts(&dir).unwrap().remove(0);
        assert!(prompt.has_frontmatter);
        assert!(prompt.frontmatter_error.is_some());
        assert_eq!(read_prompt(&dir, "broken").unwrap().body, "body");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unclosed_frontmatter_is_not_hidden_or_truncated() {
        let dir = tmp_dir("unclosed");
        let raw = "---\ntags: [review\nbody stays visible";
        write(&dir, "broken.md", raw);
        let document = read_prompt(&dir, "broken").unwrap();
        assert_eq!(document.body, raw);
        assert!(document.frontmatter_prefix.is_none());
        assert!(document.summary.frontmatter_error.is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn body_horizontal_rules_do_not_become_frontmatter() {
        let dir = tmp_dir("rule");
        write(&dir, "plain.md", "body\n---\nmore body");
        let document = read_prompt(&dir, "plain").unwrap();
        assert!(!document.summary.has_frontmatter);
        assert_eq!(document.body, "body\n---\nmore body");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn body_save_preserves_frontmatter_prefix_and_body_bytes() {
        let dir = tmp_dir("save");
        let raw = "---\ntags:\n- review\nstatus: active\n---\n\nbody\n";
        write(&dir, "p.md", raw);
        let document = read_prompt(&dir, "p").unwrap();
        save_prompt(
            &dir,
            "p",
            "\nchanged body\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert_eq!(
            saved,
            "---\ntags:\n- review\nstatus: active\n---\n\nchanged body\n"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_refuses_to_overwrite_an_external_change() {
        let dir = tmp_dir("conflict");
        create_prompt(&dir, "p", "original", &PromptMetadata::default()).unwrap();
        let document = read_prompt(&dir, "p").unwrap();
        fs::write(dir.join("p.md"), "external edit").unwrap();
        let error = save_prompt(
            &dir,
            "p",
            "local edit",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap_err();
        assert!(error.contains("PROMPT_CONFLICT"));
        assert_eq!(
            fs::read_to_string(dir.join("p.md")).unwrap(),
            "external edit"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn metadata_save_is_deterministic_and_retains_unknown_fields() {
        let dir = tmp_dir("serialize");
        write(&dir, "p.md", "---\nowner: lmz\n---\nbody");
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.tags = vec!["review".into()];
        metadata.favorite = true;
        save_prompt(
            &dir,
            "p",
            "body",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let first = fs::read_to_string(dir.join("p.md")).unwrap();
        let reread = read_prompt(&dir, "p").unwrap();
        save_prompt(
            &dir,
            "p",
            "body",
            &reread.summary.metadata,
            reread.frontmatter_prefix.as_deref(),
            true,
            Some(&reread.raw),
        )
        .unwrap();
        assert_eq!(first, fs::read_to_string(dir.join("p.md")).unwrap());
        assert!(first.contains("owner: lmz"));
        assert!(first.contains("favorite: true"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn safe_crud_supports_nested_paths_and_never_prunes_directories() {
        let dir = tmp_dir("crud");
        let created =
            create_prompt(&dir, "coding/review", "body", &PromptMetadata::default()).unwrap();
        assert_eq!(created.summary.name, "coding/review");
        let renamed = rename_prompt(&dir, "coding/review", "github/review-pr").unwrap();
        assert_eq!(renamed.summary.name, "github/review-pr");
        move_prompt(&dir, "github/review-pr", "archive/review-pr").unwrap();
        delete_prompt(&dir, "archive/review-pr").unwrap();
        assert!(dir.join("archive").is_dir());
        assert!(scan_prompts(&dir).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn folder_scan_includes_empty_folders_but_skips_dot_directories() {
        let dir = tmp_dir("folders");
        fs::create_dir_all(dir.join("empty/nested")).unwrap();
        fs::create_dir_all(dir.join(".git/hidden")).unwrap();
        assert_eq!(scan_folders(&dir).unwrap(), ["empty", "empty/nested"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unicode_prompt_names_are_valid_and_round_trip() {
        let dir = tmp_dir("unicode");
        create_prompt(&dir, "写作/客户回复", "你好", &PromptMetadata::default()).unwrap();
        let document = read_prompt(&dir, "写作/客户回复").unwrap();
        assert_eq!(document.summary.relative_path, "写作/客户回复.md");
        assert_eq!(document.body, "你好");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn traversal_and_symlink_paths_are_rejected() {
        let root = tmp_dir("safety");
        let project = root.join("project");
        let outside = root.join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        for hostile in [
            "../outside/pwned",
            "a/../../outside/pwned",
            "/etc/passwd",
            "a//b",
            ".",
            "..",
            "",
            "has:colon",
            "back\\\\slash",
        ] {
            assert!(create_prompt(&project, hostile, "pwned", &PromptMetadata::default()).is_err());
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, project.join("escape")).unwrap();
        #[cfg(unix)]
        assert!(create_prompt(
            &project,
            "escape/pwned",
            "pwned",
            &PromptMetadata::default()
        )
        .is_err());
        #[cfg(unix)]
        {
            let outside_file = outside.join("outside.md");
            fs::write(&outside_file, "outside").unwrap();
            std::os::unix::fs::symlink(&outside_file, project.join("evil.md")).unwrap();
            assert!(read_prompt(&project, "evil").is_err());
            assert!(save_prompt(
                &project,
                "evil",
                "overwrite",
                &PromptMetadata::default(),
                None,
                false,
                None
            )
            .is_err());
            assert!(rename_prompt(&project, "evil", "renamed").is_err());
            assert_eq!(fs::read_to_string(outside_file).unwrap(), "outside");
        }
        assert!(!outside.join("pwned.md").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_projects_are_loud() {
        let dir = tmp_dir("missing");
        assert!(scan_prompts(&dir.join("gone"))
            .unwrap_err()
            .contains("not found"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_matches_metadata_and_body_with_name_priority() {
        let dir = tmp_dir("search");
        let mut metadata = PromptMetadata::default();
        metadata.tags = vec!["review".into()];
        metadata.description = "Review regressions".into();
        create_prompt(&dir, "review-pr", "body", &metadata).unwrap();
        create_prompt(&dir, "misc", "review body", &PromptMetadata::default()).unwrap();
        let results = search_prompts(&dir, "review").unwrap();
        assert_eq!(results[0].name, "review-pr");
        assert_eq!(results.len(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
}
