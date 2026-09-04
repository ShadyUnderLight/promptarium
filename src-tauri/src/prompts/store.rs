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

/// IPC-safe semantic AST for arbitrary YAML (Issue #24). Every variant of
/// `serde_yaml::Value` is represented explicitly, so the conversion is an
/// exhaustive, infallible match — no YAML node (non-string mapping keys, tagged
/// nodes, exotic numbers) can be dropped or flattened into a JSON-only shape
/// when moving through IPC JSON. Mapping keys are kept as a pair list (not a
/// JSON object) so non-string keys survive; insertion order is retained for
/// faithful round-trip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RawYaml {
    Null,
    Bool { value: bool },
    Number { value: RawNumber },
    String { value: String },
    Sequence { items: Vec<RawYaml> },
    Mapping { pairs: Vec<(RawYaml, RawYaml)> },
    Tagged { tag: String, value: Box<RawYaml> },
}

/// A YAML scalar number, kept in its source integer/floating form so a round
/// trip through IPC JSON does not coerce precision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RawNumber {
    I64 { value: String },
    U64 { value: String },
    F64 { bits: String },
}

impl RawYaml {
    /// Convert a `serde_yaml::Value` into the IPC-safe AST. Exhaustive over all
    /// `serde_yaml::Value` variants, so it cannot fail and cannot drop a node.
    fn from_serde(value: &YamlValue) -> RawYaml {
        match value {
            YamlValue::Null => RawYaml::Null,
            YamlValue::Bool(value) => RawYaml::Bool { value: *value },
            YamlValue::Number(number) => RawYaml::Number {
                // Integers are carried as decimal strings (JS numbers lose
                // precision past 2^53−1); floats as IEEE-754 bit strings (so
                // NaN / ±Inf / −0.0 never touch JSON float semantics).
                value: if let Some(value) = number.as_i64() {
                    RawNumber::I64 {
                        value: value.to_string(),
                    }
                } else if let Some(value) = number.as_u64() {
                    RawNumber::U64 {
                        value: value.to_string(),
                    }
                } else {
                    RawNumber::F64 {
                        bits: format!("{:#x}", number.as_f64().unwrap_or(f64::NAN).to_bits()),
                    }
                },
            },
            YamlValue::String(value) => RawYaml::String {
                value: value.clone(),
            },
            YamlValue::Sequence(sequence) => RawYaml::Sequence {
                items: sequence.iter().map(RawYaml::from_serde).collect(),
            },
            YamlValue::Mapping(mapping) => RawYaml::Mapping {
                pairs: mapping
                    .iter()
                    .map(|(key, value)| (RawYaml::from_serde(key), RawYaml::from_serde(value)))
                    .collect(),
            },
            YamlValue::Tagged(tagged) => RawYaml::Tagged {
                tag: tagged.tag.to_string(),
                value: Box::new(RawYaml::from_serde(&tagged.value)),
            },
        }
    }

    /// Convert the AST back into a `serde_yaml::Value` for serialization. The
    /// number decode is fallible only in the impossible case that an IPC
    /// payload corrupted the decimal/bit string; surfacing it as an error (the
    /// save fails) is safer than writing a wrong number.
    fn into_serde(&self) -> Result<YamlValue, String> {
        match self {
            RawYaml::Null => Ok(YamlValue::Null),
            RawYaml::Bool { value } => Ok(YamlValue::Bool(*value)),
            RawYaml::Number { value } => Ok(YamlValue::Number(match value {
                RawNumber::I64 { value } => serde_yaml::Number::from(
                    value
                        .parse::<i64>()
                        .map_err(|e| format!("invalid i64 raw number {value:?}: {e}"))?,
                ),
                RawNumber::U64 { value } => serde_yaml::Number::from(
                    value
                        .parse::<u64>()
                        .map_err(|e| format!("invalid u64 raw number {value:?}: {e}"))?,
                ),
                RawNumber::F64 { bits } => {
                    let bits = u64::from_str_radix(bits.trim_start_matches("0x"), 16)
                        .map_err(|e| format!("invalid f64 raw bits {bits:?}: {e}"))?;
                    serde_yaml::Number::from(f64::from_bits(bits))
                }
            })),
            RawYaml::String { value } => Ok(YamlValue::String(value.clone())),
            RawYaml::Sequence { items } => Ok(YamlValue::Sequence(
                items
                    .iter()
                    .map(RawYaml::into_serde)
                    .collect::<Result<Vec<_>, _>>()?,
            )),
            RawYaml::Mapping { pairs } => {
                let mut mapping = Mapping::new();
                for (key, value) in pairs {
                    mapping.insert(key.into_serde()?, value.into_serde()?);
                }
                Ok(YamlValue::Mapping(mapping))
            }
            RawYaml::Tagged { tag, value } => Ok(YamlValue::Tagged(Box::new(
                serde_yaml::value::TaggedValue {
                    tag: serde_yaml::value::Tag::new(tag.clone()),
                    value: value.into_serde()?,
                },
            ))),
        }
    }
}

impl Default for PromptStatus {
    fn default() -> Self {
        Self::Active
    }
}

/// A single variable's optional human-readable annotation. Both fields are
/// optional; the variable's *existence* is decided exclusively by the body
/// parser on the frontend, never by this struct. Unknown nested YAML keys are
/// preserved in `extra` so a future `variables.<name>.<field>` survives edits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VariableDoc {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub example: Option<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, JsonValue>,
}

/// A single prompt example (Issue #24). Only text fields plus asset *reference*
/// paths are supported in this layer; large text / binary assets are addressed
/// by future issues. Unknown nested YAML keys are preserved in `extra` exactly
/// like `VariableDoc`. The parser never drops a field or item it cannot
/// interpret: invalid values surface as frontmatter warnings and stay intact in
/// the raw `examples` value that an unrelated metadata save re-emits (§P0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptExample {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub assets: Vec<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, JsonValue>,
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
    pub variables: BTreeMap<String, VariableDoc>,
    #[serde(default)]
    pub related: Vec<String>,
    /// Usage notes that are not part of the prompt body (Issue #15). Copy
    /// Prompt never includes them. Multiline values serialize as readable YAML
    /// block scalars; an empty value is omitted from the frontmatter on save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Prompt examples (Issue #24). The typed Vec is a read-only projection for
    /// IPC/frontend use; it is *not* the authoritative value for a save. The
    /// authoritative representation is `examples_raw` — the semantic YAML AST
    /// of the `examples` value as read from disk — so invalid or hand-written
    /// examples are never truncated to this typed Vec on an unrelated metadata
    /// save. Only an explicit editor-produced typed value (create / duplicate,
    /// where no raw exists) is serialized from `examples`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<PromptExample>>,
    /// IPC-safe semantic AST of the `examples` frontmatter field as read from
    /// disk. Preservation base for an unrelated metadata save (Issue #24 P0
    /// contract): conversion from `serde_yaml::Value` is exhaustive and
    /// infallible, so preservation never depends on JSON representability or on
    /// the serializer being able to re-emit a node. `None` when the field is
    /// absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples_raw: Option<RawYaml>,
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

/// A canonical `related` value is a project-relative prompt path without a
/// `.md` suffix, validated with the same rules used for prompt names. Values
/// that fail this test are preserved (never dropped and never silently
/// normalized) but are reported through the frontmatter warning channel, so
/// the relation can be surfaced as an invalid diagnostic instead of hiding the
/// prompt.
fn valid_relation_path(value: &str) -> bool {
    !value.ends_with(".md") && validate_name(value).is_ok()
}

/// Parse the `related` frontmatter field. Only a list of strings is supported;
/// any other shape is a warning. Every entry is kept verbatim in the metadata
/// so an invalid or unresolved value survives a supported metadata save, while
/// non-canonical entries also produce a visible warning.
fn relation_list(value: &YamlValue, errors: &mut Vec<String>) -> Vec<String> {
    let Some(values) = value.as_sequence() else {
        errors.push("related must be a list of strings".to_string());
        return Vec::new();
    };
    let mut output = Vec::with_capacity(values.len());
    for item in values {
        let Some(text) = item.as_str() else {
            errors.push("related must contain only strings".to_string());
            continue;
        };
        if !valid_relation_path(text) {
            errors.push(format!(
                "related must be a project-relative prompt path without .md: {text:?}"
            ));
        }
        output.push(text.to_string());
    }
    output
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
            "related" => metadata.related = relation_list(value, &mut errors),
            "notes" => match value.as_str() {
                Some(text) => metadata.notes = Some(text.to_string()),
                None => errors.push("notes must be a string".to_string()),
            },
            "variables" => match value.as_mapping() {
                Some(variables) => {
                    for (name, doc_value) in variables {
                        let Some(name) = name.as_str() else {
                            errors.push("variables keys must be strings".to_string());
                            continue;
                        };
                        match doc_value.as_mapping() {
                            Some(doc) => {
                                let mut variable = VariableDoc::default();
                                for (key, value) in doc {
                                    let Some(key) = key.as_str() else {
                                        // Never drop a nested unknown field
                                        // silently: mirror the top-level
                                        // "frontmatter keys must be strings"
                                        // behaviour so the user sees a warning
                                        // instead of data loss on the next save.
                                        errors.push(format!(
                                            "variables.{name} keys must be strings"
                                        ));
                                        continue;
                                    };
                                    match key {
                                        "description" => match value.as_str() {
                                            Some(text) => variable.description = Some(text.to_string()),
                                            None => errors.push(format!(
                                                "variables.{name}.description must be a string"
                                            )),
                                        },
                                        "example" => match value.as_str() {
                                            Some(text) => variable.example = Some(text.to_string()),
                                            None => errors.push(format!(
                                                "variables.{name}.example must be a string"
                                            )),
                                        },
                                        unknown => match json_from_yaml(value) {
                                            Ok(value) => {
                                                variable.extra.insert(unknown.to_string(), value);
                                            }
                                            Err(error) => errors.push(error),
                                        },
                                    }
                                }
                                metadata.variables.insert(name.to_string(), variable);
                            }
                            None => errors.push(format!(
                                "variables.{name} must be a mapping of description/example"
                            )),
                        }
                    }
                }
                None => errors.push("variables must be a mapping".to_string()),
            },
            "examples" => {
                // The raw value is always retained first, as an IPC-safe AST:
                // it is the preservation base for an unrelated metadata save
                // (Issue #24 P0). Conversion from `serde_yaml::Value` is
                // exhaustive and infallible, so no parse outcome below — and no
                // serializer limitation — can ever drop the original YAML.
                metadata.examples_raw = Some(RawYaml::from_serde(value));
                match value {
                    YamlValue::Sequence(items) => {
                        let mut parsed = Vec::with_capacity(items.len());
                        for (index, item) in items.iter().enumerate() {
                            let Some(mapping) = item.as_mapping() else {
                                errors.push(format!("examples[{index}] must be a mapping"));
                                continue;
                            };
                            let mut example = PromptExample::default();
                            let mut has_content = false;
                            for (key, field) in mapping {
                                let Some(key) = key.as_str() else {
                                    // Never drop a nested unknown key silently:
                                    // mirror the top-level "keys must be strings"
                                    // behaviour so the user sees a warning instead
                                    // of data loss on the next save.
                                    errors.push(format!("examples[{index}] keys must be strings"));
                                    continue;
                                };
                                match key {
                                    "name" => match field.as_str() {
                                        Some(text) => example.name = Some(text.to_string()),
                                        None => errors.push(format!(
                                            "examples[{index}].name must be a string"
                                        )),
                                    },
                                    "input" => match field.as_str() {
                                        Some(text) => {
                                            example.input = Some(text.to_string());
                                            has_content = true;
                                        }
                                        None => errors.push(format!(
                                            "examples[{index}].input must be a string"
                                        )),
                                    },
                                    "input_file" => match field.as_str() {
                                        Some(text) => {
                                            example.input_file = Some(text.to_string());
                                            has_content = true;
                                        }
                                        None => errors.push(format!(
                                            "examples[{index}].input_file must be a string"
                                        )),
                                    },
                                    "output" => match field.as_str() {
                                        Some(text) => {
                                            example.output = Some(text.to_string());
                                            has_content = true;
                                        }
                                        None => errors.push(format!(
                                            "examples[{index}].output must be a string"
                                        )),
                                    },
                                    "output_file" => match field.as_str() {
                                        Some(text) => {
                                            example.output_file = Some(text.to_string());
                                            has_content = true;
                                        }
                                        None => errors.push(format!(
                                            "examples[{index}].output_file must be a string"
                                        )),
                                    },
                                    "notes" => match field.as_str() {
                                        Some(text) => example.notes = Some(text.to_string()),
                                        None => errors.push(format!(
                                            "examples[{index}].notes must be a string"
                                        )),
                                    },
                                    "assets" => {
                                        example.assets = string_list(
                                            field,
                                            &format!("examples[{index}].assets"),
                                            &mut errors,
                                        );
                                        if !example.assets.is_empty() {
                                            has_content = true;
                                        }
                                    }
                                    unknown => match json_from_yaml(field) {
                                        Ok(value) => {
                                            example.extra.insert(unknown.to_string(), value);
                                        }
                                        Err(error) => errors.push(error),
                                    },
                                }
                            }
                            if example.input.is_some() && example.input_file.is_some() {
                                errors.push(format!(
                                    "examples[{index}] has both input and input_file; both are preserved"
                                ));
                            }
                            if example.output.is_some() && example.output_file.is_some() {
                                errors.push(format!(
                                    "examples[{index}] has both output and output_file; both are preserved"
                                ));
                            }
                            if !has_content {
                                errors.push(format!(
                                    "examples[{index}] has no content; an example needs input, input_file, output, output_file or assets"
                                ));
                            }
                            parsed.push(example);
                        }
                        metadata.examples = Some(parsed);
                    }
                    _ => errors.push("examples must be a list of mappings".to_string()),
                }
            }
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
        .ok()
        .and_then(|metadata| modified_at_from_metadata(&metadata))
        .unwrap_or(0)
}

/// Modified timestamp (ms since epoch) from an already-obtained metadata
/// snapshot, without re-stating the path. Callers that already hold a
/// `symlink_metadata` result pass it here so state and modifiedAt both come
/// from one filesystem snapshot — never a second, symlink-following stat.
fn modified_at_from_metadata(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
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
        has_frontmatter: parsed.has_frontmatter,
        frontmatter_error: parsed.frontmatter_error.clone(),
    };
    Some((result, parsed))
}

pub(crate) fn project_root(project: &Path) -> Result<PathBuf, String> {
    if !project.exists() {
        return Err(format!("PROJECT_FOLDER_NOT_FOUND: {}", project.display()));
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

/// Resolution state of one asset reference (Issue #25). `resolved` = an
/// existing regular non-`.md` file inside the Project; `missing` = syntactically
/// valid but absent (a broken reference, not invalid syntax); `invalid` = an
/// unsafe / unsupported path (absolute, escape, symlink, `.md`, non-regular
/// target, canonicalization failure).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetResolutionState {
    Resolved,
    Missing,
    Invalid,
}

/// Display-only kind hint derived from the reference extension (Issue #25).
/// Explicitly not a security boundary: any safe non-`.md` regular file may be
/// referenced regardless of its kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Pdf,
    Text,
    Json,
    Binary,
}

/// One classified asset reference (Issue #25). `reference` is the raw
/// project-relative string as written in frontmatter; filesystem state is
/// classified by Rust alone — the frontend never resolves paths itself.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPromptAsset {
    pub reference: String,
    pub state: AssetResolutionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<AssetKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Whether a reference's leaf name ends in `.md` (case-insensitive). The
/// scanner treats every visible `.md` as a prompt (#16 invariant), so an asset
/// reference can never point at one — making the scanner collision structurally
/// impossible without any scanner special-casing.
fn has_markdown_leaf(reference: &str) -> bool {
    let leaf = reference.rsplit('/').next().unwrap_or(reference);
    leaf.to_ascii_lowercase().ends_with(".md")
}

/// Extension-derived display hint for an asset reference. Not a security
/// boundary — see `AssetKind`.
fn asset_kind_for(reference: &str) -> AssetKind {
    let extension = Path::new(reference)
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase());
    match extension.as_deref() {
        Some("png" | "jpg" | "jpeg" | "webp" | "gif") => AssetKind::Image,
        Some("pdf") => AssetKind::Pdf,
        Some("json") => AssetKind::Json,
        Some("txt" | "log" | "csv" | "tsv" | "yaml" | "yml" | "toml" | "xml" | "html") => {
            AssetKind::Text
        }
        _ => AssetKind::Binary,
    }
}

/// Classify a single asset reference against the current filesystem (Issue
/// #25). Path safety reuses the prompt machinery (`validate_name` +
/// `safe_relative_path`), so there is exactly one path-authority implementation
/// in Rust; the only new rule is the non-`.md` asset invariant. A bad reference
/// never fails a caller: every reference maps to exactly one classification.
fn resolve_asset(project: &Path, reference: &str) -> ResolvedPromptAsset {
    let invalid = |error: String| ResolvedPromptAsset {
        reference: reference.to_string(),
        state: AssetResolutionState::Invalid,
        kind: None,
        size_bytes: None,
        modified_at: None,
        error: Some(error),
    };
    if has_markdown_leaf(reference) {
        return invalid(format!(
            "asset reference may not point at a Markdown prompt: {reference}"
        ));
    }
    let path = match safe_relative_path(project, reference, None) {
        Ok(path) => path,
        Err(error) => return invalid(error),
    };
    let kind = asset_kind_for(reference);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => ResolvedPromptAsset {
            reference: reference.to_string(),
            state: AssetResolutionState::Resolved,
            kind: Some(kind),
            size_bytes: Some(metadata.len()),
            modified_at: modified_at_from_metadata(&metadata),
            error: None,
        },
        Ok(_) => invalid(format!("asset target is not a regular file: {reference}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ResolvedPromptAsset {
            reference: reference.to_string(),
            state: AssetResolutionState::Missing,
            kind: None,
            size_bytes: None,
            modified_at: None,
            error: None,
        },
        Err(error) => invalid(error.to_string()),
    }
}

/// Classify every reference independently (Issue #25). The batch never fails as
/// a whole: an unsupported reference yields an `invalid` entry while the rest
/// are still classified.
pub fn resolve_prompt_assets(project: &Path, references: &[String]) -> Vec<ResolvedPromptAsset> {
    references
        .iter()
        .map(|reference| resolve_asset(project, reference))
        .collect()
}

/// Re-validate an asset reference for Reveal (Issue #25). Fails closed with a
/// clear error — never a parent-folder fallback — unless the reference is a
/// safe, existing regular non-`.md` file inside the Project. Kept as a separate
/// seam from the Prompt-only reveal contract so the two path contracts never
/// mix.
pub fn asset_absolute_path_for_reveal(project: &Path, reference: &str) -> Result<PathBuf, String> {
    if has_markdown_leaf(reference) {
        return Err(format!(
            "asset reference may not point at a Markdown prompt: {reference}"
        ));
    }
    let path = safe_relative_path(project, reference, None)?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("asset target cannot be read: {reference}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("asset target is not a regular file: {reference}"));
    }
    Ok(path)
}

/// Normalize a picked Project-relative path into the reference grammar
/// (Issue #30 P3). On Windows `\` is the path separator and must become `/`;
/// on Unix/macOS a literal `\` is a real filename character, which the
/// reference grammar rejects (`validate_name`). Rewriting it would silently
/// turn `assets/a\b.png` into `assets/a/b.png` — a reference that points at a
/// different file than the user actually selected — so it fails closed instead
/// of returning a reference that does not represent the selection.
fn picked_relative_reference(relative: &Path, selected_display: &str) -> Result<String, String> {
    let reference = relative.to_string_lossy();
    #[cfg(windows)]
    {
        Ok(reference.replace('\\', "/"))
    }
    #[cfg(not(windows))]
    {
        if reference.contains('\\') {
            return Err(format!(
                "selected path contains a literal '\\', which is not a valid asset reference: {selected_display}"
            ));
        }
        Ok(reference.into_owned())
    }
}

/// Convert an absolute path the user selected in the file dialog into a
/// canonical Project-relative asset reference (Issue #26 §8). This is the
/// picker's authority seam: the frontend never computes relative paths from
/// strings. Rust validates the Project registration (the caller does), that the
/// selected path canonicalizes to a real regular file inside the Project root,
/// and that the resulting reference satisfies the exact same contract as one
/// written by hand (`safe_relative_path` + the non-`.md` asset invariant), so a
/// picked reference can never be one the resolver would classify differently.
pub fn asset_reference_from_selected_path(
    project: &Path,
    absolute_path: &str,
) -> Result<String, String> {
    let root = project_root(project)?;
    let selected = PathBuf::from(absolute_path);
    if !selected.is_absolute() {
        return Err(format!("selected path is not absolute: {absolute_path}"));
    }
    // Compute the relative path from the LEXICAL selection before any
    // canonicalization. Resolving the symlink first would silently rewrite
    // `assets/link.png -> assets/real.png` into `assets/real.png` and hide the
    // symlink from every check below — the exact gap a Project-internal symlink
    // would exploit. Strip against both the canonical root and the registered
    // (possibly symlinked) project path so a project whose own root is a
    // symlink still works.
    let relative = selected
        .strip_prefix(&root)
        .ok()
        .or_else(|| selected.strip_prefix(project).ok())
        .ok_or_else(|| {
            format!(
                "selected file is outside the current Project: {}",
                selected.display()
            )
        })?;
    let relative = picked_relative_reference(relative, &format!("{}", selected.display()))?;
    if has_markdown_leaf(&relative) {
        return Err(format!(
            "asset reference may not point at a Markdown prompt: {relative}"
        ));
    }
    // Validate the lexical relative path through the standard reference
    // machinery BEFORE canonicalizing: `safe_relative_path` walks every
    // component and rejects symlinks, escape and dot segments exactly like a
    // hand-written reference (Issue #25). A Project-internal symlink is
    // rejected here instead of being rewritten to its target.
    safe_relative_path(project, &relative, None)?;
    // Only now resolve the target: it must still be inside the Project and be
    // an existing regular file.
    let canonical = selected
        .canonicalize()
        .map_err(|error| format!("selected path cannot be read: {absolute_path}: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "selected file is outside the current Project: {}",
            selected.display()
        ));
    }
    let metadata = fs::symlink_metadata(&canonical)
        .map_err(|error| format!("selected path cannot be read: {absolute_path}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "selected path is not a regular file: {}",
            selected.display()
        ));
    }
    Ok(relative)
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
        return Err(format!("PROMPT_FILE_NOT_FOUND: {}", path.display()));
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
        || !metadata.variables.is_empty()
        || !metadata.related.is_empty()
        || metadata.notes.as_deref().is_some_and(|notes| !notes.is_empty())
        || metadata.examples_raw.is_some()
        || metadata
            .examples
            .as_ref()
            .is_some_and(|examples| !examples.is_empty())
        || !metadata.extra.is_empty()
}

fn yaml_string(value: &str) -> YamlValue {
    YamlValue::String(value.to_string())
}

fn yaml_from_json(value: &JsonValue) -> Result<YamlValue, String> {
    serde_yaml::to_value(value).map_err(|e| e.to_string())
}

/// Serialize one typed `PromptExample` to YAML. This is only used when there is
/// no raw value to preserve (create / duplicate): it emits snake_case keys,
/// omits absent fields, and writes multiline strings as readable block scalars
/// through the serializer, mirroring the `notes` behaviour.
fn example_to_yaml(example: &PromptExample) -> Result<YamlValue, String> {
    let mut mapping = Mapping::new();
    if let Some(name) = &example.name {
        mapping.insert(yaml_string("name"), yaml_string(name));
    }
    if let Some(input) = &example.input {
        mapping.insert(yaml_string("input"), yaml_string(input));
    }
    if let Some(input_file) = &example.input_file {
        mapping.insert(yaml_string("input_file"), yaml_string(input_file));
    }
    if let Some(output) = &example.output {
        mapping.insert(yaml_string("output"), yaml_string(output));
    }
    if let Some(output_file) = &example.output_file {
        mapping.insert(yaml_string("output_file"), yaml_string(output_file));
    }
    if let Some(notes) = &example.notes {
        mapping.insert(yaml_string("notes"), yaml_string(notes));
    }
    if !example.assets.is_empty() {
        mapping.insert(
            yaml_string("assets"),
            YamlValue::Sequence(
                example
                    .assets
                    .iter()
                    .map(|asset| yaml_string(asset))
                    .collect(),
            ),
        );
    }
    for (key, value) in &example.extra {
        mapping.insert(yaml_string(key), yaml_from_json(value)?);
    }
    Ok(YamlValue::Mapping(mapping))
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
    if !metadata.variables.is_empty() {
        let mut variables = Mapping::new();
        for (name, doc) in &metadata.variables {
            let mut fields = Mapping::new();
            if let Some(description) = &doc.description {
                fields.insert(yaml_string("description"), yaml_string(description));
            }
            if let Some(example) = &doc.example {
                fields.insert(yaml_string("example"), yaml_string(example));
            }
            for (key, value) in &doc.extra {
                fields.insert(yaml_string(key), yaml_from_json(value)?);
            }
            variables.insert(yaml_string(name), YamlValue::Mapping(fields));
        }
        mapping.insert(yaml_string("variables"), YamlValue::Mapping(variables));
    }
    if !metadata.related.is_empty() {
        mapping.insert(
            yaml_string("related"),
            YamlValue::Sequence(metadata.related.iter().map(|related| yaml_string(related)).collect()),
        );
    }
    if let Some(notes) = &metadata.notes {
        // Empty notes are deliberately omitted so clearing the field removes it
        // from the frontmatter instead of leaving `notes: ""` behind. Multiline
        // values are emitted as readable YAML block scalars by the serializer.
        if !notes.is_empty() {
            mapping.insert(yaml_string("notes"), yaml_string(notes));
        }
    }
    // Examples (Issue #24): an unrelated metadata save re-emits the raw AST
    // (the preservation base for invalid/hand-written examples). Rebuilding the
    // `serde_yaml::Value` is infallible; if the underlying serializer then
    // cannot re-emit a node (e.g. a tagged mapping key), `serde_yaml::to_string`
    // below fails the whole save instead of silently dropping the examples —
    // data safety wins over edit availability. Only when no raw exists (create /
    // duplicate producing a typed value) is the typed projection serialized. An
    // empty typed list is omitted, matching `notes`.
    if let Some(raw) = &metadata.examples_raw {
        mapping.insert(yaml_string("examples"), raw.into_serde()?);
    } else if let Some(examples) = &metadata.examples {
        if !examples.is_empty() {
            let sequence = examples
                .iter()
                .map(example_to_yaml)
                .collect::<Result<Vec<_>, _>>()?;
            mapping.insert(yaml_string("examples"), YamlValue::Sequence(sequence));
        }
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
        return Err(format!("PROMPT_FILE_NOT_FOUND: {}", source.display()));
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
            .contains("PROJECT_FOLDER_NOT_FOUND"));
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

    // ── variable contracts ────────────────────────────────────────────────

    #[test]
    fn variables_missing_defaults_to_empty_annotations_without_migration() {
        let dir = tmp_dir("vars-missing");
        write(&dir, "plain.md", "body {repository}\n");
        let document = read_prompt(&dir, "plain").unwrap();
        assert!(document.summary.metadata.variables.is_empty());
        // Body-only save of a plain markdown file must not add a `variables` field.
        save_prompt(
            &dir,
            "plain",
            "body {repository}\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dir.join("plain.md")).unwrap(), "body {repository}\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn variables_parse_description_and_example_variants() {
        let cases: Vec<(&str, &str, Option<&str>, Option<&str>)> = vec![
            ("---\nvariables:\n  a:\n    description: repo\n---\n{a}", "a", Some("repo"), None),
            ("---\nvariables:\n  a:\n    example: \"9\"\n---\n{a}", "a", None, Some("9")),
            (
                "---\nvariables:\n  a:\n    description: Pull request\n    example: \"9\"\n---\n{a}",
                "a",
                Some("Pull request"),
                Some("9"),
            ),
            (
                "---\nvariables:\n  a:\n    description: 仓库 名称\n    example: 示例\n---\n{a}",
                "a",
                Some("仓库 名称"),
                Some("示例"),
            ),
        ];
        for (raw, name, description, example) in cases {
            let dir = tmp_dir("vars-variant");
            write(&dir, "p.md", raw);
            let document = read_prompt(&dir, "p").unwrap();
            let doc = &document.summary.metadata.variables[name];
            assert_eq!(doc.description.as_deref(), description, "case {raw:?}");
            assert_eq!(doc.example.as_deref(), example, "case {raw:?}");
            assert!(!document.summary.metadata.extra.contains_key("variables"));
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn multiline_and_quoted_variable_strings_round_trip() {
        let dir = tmp_dir("vars-multiline");
        write(
            &dir,
            "p.md",
            "---\nvariables:\n  a:\n    description: |-\n      First line\n      Second line\n---\n{a}\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            document.summary.metadata.variables["a"].description.as_deref(),
            Some("First line\nSecond line")
        );
        let mut metadata = document.summary.metadata.clone();
        save_prompt(
            &dir,
            "p",
            "{a}\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.variables["a"].description.as_deref(),
            Some("First line\nSecond line")
        );
        assert_eq!(reread.summary.metadata.variables["a"].example, None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn variables_keep_unknown_nested_fields_and_top_level_unknown_fields() {
        let dir = tmp_dir("vars-unknown");
        write(
            &dir,
            "p.md",
            "---\nvariables:\n  a:\n    description: repo\n    owner: lmz\n  b:\n    hint: x\ntop: keep\n---\n{a} {b}\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            document.summary.metadata.variables["a"].extra["owner"],
            JsonValue::String("lmz".into())
        );
        assert_eq!(
            document.summary.metadata.variables["b"].extra["hint"],
            JsonValue::String("x".into())
        );
        assert_eq!(
            document.summary.metadata.extra["top"],
            JsonValue::String("keep".into())
        );
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "{a} {b}\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(saved.contains("owner: lmz"), "nested unknown must survive: {saved}");
        assert!(saved.contains("hint: x"), "nested unknown must survive: {saved}");
        assert!(saved.contains("top: keep"), "top-level unknown must survive: {saved}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn body_only_save_does_not_reorder_or_add_variables() {
        let dir = tmp_dir("vars-body-save");
        let raw = "---\nvariables:\n  a:\n    description: A\n  b:\n    description: B\n---\nbody {a} {b}\n";
        write(&dir, "p.md", raw);
        let document = read_prompt(&dir, "p").unwrap();
        save_prompt(
            &dir,
            "p",
            "changed {a} {b}\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        // Non-dirty body save keeps the exact original frontmatter prefix bytes.
        assert_eq!(
            fs::read_to_string(dir.join("p.md")).unwrap(),
            "---\nvariables:\n  a:\n    description: A\n  b:\n    description: B\n---\nchanged {a} {b}\n"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn explicit_variable_metadata_save_writes_expected_fields() {
        let dir = tmp_dir("vars-explicit-save");
        write(&dir, "p.md", "body {a}\n");
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.variables.insert(
            "a".into(),
            VariableDoc {
                description: Some("Repo".into()),
                example: Some("org/repo".into()),
                extra: BTreeMap::new(),
            },
        );
        save_prompt(
            &dir,
            "p",
            "body {a}\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(saved.contains("variables:"), "{saved}");
        assert!(saved.contains("description: Repo"), "{saved}");
        assert!(saved.contains("example: org/repo"), "{saved}");
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.variables["a"].description.as_deref(),
            Some("Repo")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removing_a_stale_annotation_only_removes_that_annotation() {
        let dir = tmp_dir("vars-remove-stale");
        write(
            &dir,
            "p.md",
            "---\nvariables:\n  a:\n    description: A\n  b:\n    description: B\n---\nbody {a}\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.variables.remove("b");
        save_prompt(
            &dir,
            "p",
            "body {a}\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(!saved.contains("description: B"), "removed annotation must be gone: {saved}");
        assert!(saved.contains("description: A"), "other annotation must stay: {saved}");
        assert!(saved.contains("body {a}"), "body must stay untouched: {saved}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn variables_save_still_refuses_to_overwrite_an_external_change() {
        let dir = tmp_dir("vars-conflict");
        create_prompt(&dir, "p", "body {a}", &PromptMetadata::default()).unwrap();
        let document = read_prompt(&dir, "p").unwrap();
        fs::write(dir.join("p.md"), "external edit").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.variables.insert(
            "a".into(),
            VariableDoc {
                description: Some("A".into()),
                example: None,
                extra: BTreeMap::new(),
            },
        );
        let error = save_prompt(
            &dir,
            "p",
            "body {a}",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
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
    fn non_string_keys_under_a_variable_report_a_parse_error() {
        let dir = tmp_dir("vars-nonstring-key");
        write(
            &dir,
            "p.md",
            "---\nvariables:\n  repository:\n    1: keep-me\n---\nbody {repository}\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("variables.repository keys must be strings"),
            "non-string nested keys must be loud, got: {error}"
        );
        // Supported fields under the same variable still parse.
        assert!(document.summary.metadata.variables.contains_key("repository"));
        fs::remove_dir_all(dir).unwrap();
    }

    // ── related / backlinks ────────────────────────────────────────────────

    #[test]
    fn related_missing_defaults_to_empty_without_migration() {
        let dir = tmp_dir("related-missing");
        write(&dir, "plain.md", "body\n");
        let document = read_prompt(&dir, "plain").unwrap();
        assert!(document.summary.metadata.related.is_empty());
        // A body-only save of a plain Markdown file must not add a `related` field.
        save_prompt(
            &dir,
            "plain",
            "body\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dir.join("plain.md")).unwrap(), "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn related_parses_canonical_paths_and_round_trips() {
        let dir = tmp_dir("related-parse");
        write(
            &dir,
            "p.md",
            "---\nrelated:\n  - coding/github/fix-pr\n  - review/检查清单\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            document.summary.metadata.related,
            ["coding/github/fix-pr", "review/检查清单"]
        );
        assert!(document.summary.frontmatter_error.is_none());
        assert!(!document.summary.metadata.extra.contains_key("related"));

        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(saved.contains("related:"), "{saved}");
        assert!(saved.contains("- coding/github/fix-pr"), "{saved}");
        assert!(saved.contains("- review/检查清单"), "{saved}");
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.related,
            ["coding/github/fix-pr", "review/检查清单"]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn related_invalid_paths_warn_but_stay_visible_and_round_trip() {
        let cases = [
            "coding/foo.md",     // explicit .md suffix is invalid, not normalized
            "/Users/me/prompt",  // absolute path
            "a/../outside",      // path escape
            "a//b",              // empty segment
        ];
        for raw in cases {
            let dir = tmp_dir("related-invalid");
            let yaml = format!("---\nrelated:\n  - {raw}\n---\nbody\n");
            write(&dir, "p.md", &yaml);
            let document = read_prompt(&dir, "p").unwrap();
            let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
            assert!(
                error.contains("related must be a project-relative prompt path"),
                "invalid related {raw:?} must be loud, got: {error}"
            );
            // The entry is preserved, never dropped and never normalized.
            assert_eq!(document.summary.metadata.related, [raw]);
            assert_eq!(document.body, "body\n");
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn related_empty_entry_warns_without_hiding_the_prompt() {
        // An empty YAML sequence item parses as a null scalar, which is not a
        // string reference; it is loud (like the variables string_list) and the
        // prompt stays fully readable.
        let dir = tmp_dir("related-empty");
        write(&dir, "p.md", "---\nrelated:\n  -\n---\nbody\n");
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(error.contains("related"), "empty related entry must be loud, got: {error}");
        assert_eq!(document.body, "body\n");
        assert!(document.summary.metadata.related.is_empty());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn related_wrong_type_warns_and_defaults_to_empty() {
        let dir = tmp_dir("related-wrong-type");
        write(&dir, "p.md", "---\nrelated: coding/foo\n---\nbody\n");
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("related must be a list of strings"),
            "scalar related must be loud, got: {error}"
        );
        assert!(document.summary.metadata.related.is_empty());
        assert_eq!(document.body, "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn related_duplicates_are_preserved_verbatim_by_the_serializer() {
        // Deduplication is a display-time concern (see relations.ts); the
        // serializer must not silently rewrite what the user wrote.
        let dir = tmp_dir("related-dup");
        let raw = "---\nrelated:\n  - coding/a\n  - coding/a\n---\nbody\n";
        write(&dir, "p.md", raw);
        let document = read_prompt(&dir, "p").unwrap();
        assert_eq!(document.summary.metadata.related, ["coding/a", "coding/a"]);
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert_eq!(saved.matches("- coding/a").count(), 2, "{saved}");
        fs::remove_dir_all(dir).unwrap();
    }

    // ── usage notes (Issue #15) ─────────────────────────────────────────────

    #[test]
    fn notes_missing_defaults_to_none_without_migration() {
        let dir = tmp_dir("notes-missing");
        write(&dir, "plain.md", "body\n");
        let document = read_prompt(&dir, "plain").unwrap();
        assert_eq!(document.summary.metadata.notes, None);
        // A body-only save of a plain Markdown file must not add a `notes` field.
        save_prompt(
            &dir,
            "plain",
            "body\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dir.join("plain.md")).unwrap(), "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_parse_single_line_and_multiline_block_scalar() {
        let dir = tmp_dir("notes-parse");
        write(
            &dir,
            "single.md",
            "---\nnotes: Works best with concise repository context.\n---\nbody\n",
        );
        write(
            &dir,
            "multi.md",
            "---\nnotes: |-\n  Works best for normal-sized pull requests.\n\n  For architecture reviews, set the focus to:\n  architecture, boundaries and dependency direction.\n---\nbody\n",
        );
        let single = read_prompt(&dir, "single").unwrap();
        assert_eq!(
            single.summary.metadata.notes.as_deref(),
            Some("Works best with concise repository context.")
        );
        assert!(single.summary.frontmatter_error.is_none());
        assert!(!single.summary.metadata.extra.contains_key("notes"));
        let multi = read_prompt(&dir, "multi").unwrap();
        assert_eq!(
            multi.summary.metadata.notes.as_deref(),
            Some(
                "Works best for normal-sized pull requests.\n\nFor architecture reviews, set the focus to:\narchitecture, boundaries and dependency direction."
            )
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_multiline_save_writes_a_readable_block_scalar() {
        let dir = tmp_dir("notes-multiline-save");
        write(&dir, "p.md", "body\n");
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = Some(
            "First paragraph.\n\nSecond paragraph with blank lines and unicode ✅.\nColon: value, hash #, --- dash".into(),
        );
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("notes: |"),
            "multiline notes must serialize as a readable block scalar, got:\n{saved}"
        );
        assert!(
            !saved.contains("\\n"),
            "multiline notes must not serialize as an escaped string, got:\n{saved}"
        );
        // parse -> explicit save -> parse must preserve the value semantically.
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.notes,
            metadata.notes,
            "round trip must preserve multiline notes semantically"
        );
        assert_eq!(reread.body, "body\n", "notes edit must not touch the body");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_blank_lines_and_unicode_survive_a_round_trip() {
        let dir = tmp_dir("notes-blank-unicode");
        let notes = "用法说明：在中文场景使用。\n\n✅ 稳定；✅ 边界需人工检查。\n\n最后一行。";
        let raw = format!(
            "---\nnotes: |-\n  用法说明：在中文场景使用。\n\n  ✅ 稳定；✅ 边界需人工检查。\n\n  最后一行。\n---\nbody\n"
        );
        write(&dir, "p.md", &raw);
        let document = read_prompt(&dir, "p").unwrap();
        assert_eq!(document.summary.metadata.notes.as_deref(), Some(notes));
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.notes.as_deref(),
            Some(notes),
            "blank lines and unicode must survive an explicit save"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_cleared_on_save_removes_the_field() {
        let dir = tmp_dir("notes-clear");
        write(
            &dir,
            "p.md",
            "---\nnotes: |\n  Some guidance.\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = None;
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            !saved.contains("notes"),
            "cleared notes must be removed from the frontmatter, got:\n{saved}"
        );
        assert!(
            !saved.contains("notes: \"\""),
            "cleared notes must not leave an empty string, got:\n{saved}"
        );
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(reread.summary.metadata.notes, None);
        assert_eq!(reread.body, "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_wrong_type_warns_and_defaults_to_none() {
        let dir = tmp_dir("notes-wrong-type");
        write(&dir, "p.md", "---\nnotes:\n  - item\n---\nbody\n");
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("notes must be a string"),
            "non-string notes must be loud, got: {error}"
        );
        assert_eq!(document.summary.metadata.notes, None);
        assert_eq!(document.body, "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn empty_notes_are_treated_like_missing_and_removed_on_save() {
        let dir = tmp_dir("notes-empty");
        write(&dir, "p.md", "---\nnotes: \"\"\n---\nbody\n");
        let document = read_prompt(&dir, "p").unwrap();
        // An explicit empty string parses as an empty note; it is not a
        // frontmatter error and behaves like no notes.
        assert_eq!(document.summary.metadata.notes, Some(String::new()));
        assert!(document.summary.frontmatter_error.is_none());
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            !saved.contains("notes"),
            "an empty note must be omitted from the frontmatter on save, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_only_prompt_writes_frontmatter() {
        let dir = tmp_dir("notes-only");
        let mut metadata = PromptMetadata::default();
        metadata.notes = Some("Works best on large pull requests.".into());
        create_prompt(&dir, "p", "body", &metadata).unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(saved.starts_with("---\n"), "{saved}");
        assert!(saved.contains("notes: Works best on large pull requests."), "{saved}");
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.notes.as_deref(),
            Some("Works best on large pull requests.")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_edit_preserves_body_bytes_and_unknown_fields() {
        let dir = tmp_dir("notes-preserve");
        let raw = "---\nowner: lmz\nnotes: |\n  Original.\n---\n\nbody  {ticket}\n";
        write(&dir, "p.md", raw);
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = Some("Edited.\n\nSecond line.".into());
        save_prompt(
            &dir,
            "p",
            &document.body,
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("body  {ticket}\n"),
            "body bytes must stay untouched, got:\n{saved}"
        );
        assert!(saved.contains("owner: lmz"), "unknown field must survive, got:\n{saved}");
        assert!(saved.contains("notes: |"), "multiline notes block scalar, got:\n{saved}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn notes_save_still_refuses_to_overwrite_an_external_change() {
        let dir = tmp_dir("notes-conflict");
        create_prompt(&dir, "p", "body", &PromptMetadata::default()).unwrap();
        let document = read_prompt(&dir, "p").unwrap();
        fs::write(dir.join("p.md"), "external edit").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = Some("local note".into());
        let error = save_prompt(
            &dir,
            "p",
            "body",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
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

    // ── prompt examples (Issue #24) ─────────────────────────────────────────

    #[test]
    fn examples_missing_defaults_to_none_without_migration() {
        let dir = tmp_dir("examples-missing");
        write(&dir, "plain.md", "body\n");
        let document = read_prompt(&dir, "plain").unwrap();
        assert_eq!(document.summary.metadata.examples, None);
        assert_eq!(document.summary.metadata.examples_raw, None);
        // A body-only save of a plain Markdown file must not add an `examples` field.
        save_prompt(
            &dir,
            "plain",
            "body\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(dir.join("plain.md")).unwrap(), "body\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_parse_text_only_round_trips_order_and_snake_case_keys() {
        let dir = tmp_dir("examples-parse");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: Small PR\n    input: |-\n      Repository: foo/bar\n      PR: 9\n    output: Looks good; add a test for the null case.\n    notes: Minimal happy-path example.\n  - name: Large PR\n    input: inline input text\n    output: inline output text\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        assert!(document.summary.frontmatter_error.is_none());
        let examples = document.summary.metadata.examples.as_deref().unwrap();
        assert_eq!(examples.len(), 2, "order and count preserved");
        assert_eq!(examples[0].name.as_deref(), Some("Small PR"));
        assert_eq!(
            examples[0].input.as_deref(),
            Some("Repository: foo/bar\nPR: 9")
        );
        assert_eq!(
            examples[0].output.as_deref(),
            Some("Looks good; add a test for the null case.")
        );
        assert_eq!(
            examples[0].notes.as_deref(),
            Some("Minimal happy-path example.")
        );
        assert_eq!(examples[1].name.as_deref(), Some("Large PR"));
        assert_eq!(examples[1].input.as_deref(), Some("inline input text"));
        // The raw semantic value is always retained for an unrelated save.
        assert!(document.summary.metadata.examples_raw.is_some());
        assert!(!document.summary.metadata.extra.contains_key("examples"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_snake_case_keys_map_to_dto_camel_case() {
        let dir = tmp_dir("examples-camel");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - input_file: examples/review-pr-input.txt\n    output_file: examples/review-pr-output.txt\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let example = &document.summary.metadata.examples.as_deref().unwrap()[0];
        assert_eq!(
            example.input_file.as_deref(),
            Some("examples/review-pr-input.txt")
        );
        assert_eq!(
            example.output_file.as_deref(),
            Some("examples/review-pr-output.txt")
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_multiline_save_writes_a_readable_block_scalar() {
        let dir = tmp_dir("examples-multiline-save");
        write(&dir, "p.md", "body\n");
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.examples = Some(vec![PromptExample {
            name: Some("Multi".into()),
            input: Some("Line one.\nLine two.".into()),
            output: Some("Output line.\n✅ done.".into()),
            notes: None,
            ..PromptExample::default()
        }]);
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("input: |"),
            "multiline input must serialize as a readable block scalar, got:\n{saved}"
        );
        assert!(
            !saved.contains("\\n"),
            "multiline input must not serialize as an escaped string, got:\n{saved}"
        );
        // parse -> explicit save -> parse must preserve the value semantically.
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.examples, metadata.examples,
            "round trip must preserve examples semantically"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_keep_unknown_nested_fields_and_top_level_unknown_fields() {
        let dir = tmp_dir("examples-unknown");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: A\n    input: in\n    custom_field: preserve-me\n    weird:\n      foo: bar\ntop: keep\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let example = &document.summary.metadata.examples.as_deref().unwrap()[0];
        assert_eq!(
            example.extra["custom_field"],
            JsonValue::String("preserve-me".into())
        );
        assert_eq!(
            example.extra["weird"]["foo"],
            JsonValue::String("bar".into())
        );
        assert_eq!(
            document.summary.metadata.extra["top"],
            JsonValue::String("keep".into())
        );
        // Unrelated metadata save must keep nested unknown example fields.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("custom_field: preserve-me"),
            "nested unknown example field must survive, got:\n{saved}"
        );
        assert!(
            saved.contains("top: keep"),
            "top-level unknown must survive, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_assets_string_list_parses() {
        let dir = tmp_dir("examples-assets");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: Ref\n    input: in\n    assets:\n      - assets/reference.png\n      - assets/other.png\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let example = &document.summary.metadata.examples.as_deref().unwrap()[0];
        assert_eq!(example.assets, ["assets/reference.png", "assets/other.png"]);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_empty_example_warns_but_is_preserved() {
        let dir = tmp_dir("examples-empty");
        write(&dir, "p.md", "---\nexamples:\n  - name: Empty\n---\nbody\n");
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("has no content"),
            "an example with only a name must be loud, got: {error}"
        );
        assert_eq!(
            document.summary.metadata.examples.as_deref().unwrap().len(),
            1
        );
        assert!(document.summary.metadata.examples_raw.is_some());
        assert_eq!(document.body, "body\n");
        // An unrelated save keeps the empty example intact semantically.
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = Some("added".into());
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("name: Empty"),
            "empty example must survive, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_mutually_exclusive_pairs_warn_but_both_are_preserved() {
        let dir = tmp_dir("examples-exclusive");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: Both\n    input: inline input\n    input_file: examples/in.txt\n    output: inline output\n    output_file: examples/out.txt\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("both input and input_file"),
            "input + input_file must be loud, got: {error}"
        );
        assert!(
            error.contains("both output and output_file"),
            "output + output_file must be loud, got: {error}"
        );
        let example = &document.summary.metadata.examples.as_deref().unwrap()[0];
        assert_eq!(example.input.as_deref(), Some("inline input"));
        assert_eq!(example.input_file.as_deref(), Some("examples/in.txt"));
        assert_eq!(example.output.as_deref(), Some("inline output"));
        assert_eq!(example.output_file.as_deref(), Some("examples/out.txt"));
        // Unrelated save must never silently repair or drop either side.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(saved.contains("input_file: examples/in.txt"), "{saved}");
        assert!(saved.contains("input: inline input"), "{saved}");
        assert!(saved.contains("output_file: examples/out.txt"), "{saved}");
        assert!(saved.contains("output: inline output"), "{saved}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_wrong_type_field_warns_without_dropping_the_raw_value() {
        let dir = tmp_dir("examples-wrong-type");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: Broken\n    input: 123\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("examples[0].input must be a string"),
            "wrong-typed field must be loud, got: {error}"
        );
        assert_eq!(
            document.summary.metadata.examples.as_deref().unwrap()[0].input,
            None,
            "typed projection has no value for the wrong-typed field"
        );
        assert!(document.summary.metadata.examples_raw.is_some());
        // The raw value keeps the wrong-typed scalar; an unrelated save preserves it.
        let mut metadata = document.summary.metadata.clone();
        metadata.tags = vec!["review".into()];
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("input: 123"),
            "wrong-typed example value must survive, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_wrong_top_level_shape_survives_an_unrelated_save() {
        let dir = tmp_dir("examples-wrong-shape");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  strange-shape:\n    whatever: true\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let error = document.summary.frontmatter_error.as_deref().unwrap_or("");
        assert!(
            error.contains("examples must be a list of mappings"),
            "non-list examples must be loud, got: {error}"
        );
        // A non-list shape cannot be projected into typed examples; the typed
        // view reports nothing while the raw value stays authoritative.
        assert_eq!(document.summary.metadata.examples, None);
        assert!(document.summary.metadata.examples_raw.is_some());
        assert_eq!(document.body, "body\n");
        // description-only save must preserve the malformed examples semantically.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("strange-shape") && saved.contains("whatever: true"),
            "malformed examples must survive a supported metadata save, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_malformed_item_survives_an_unrelated_notes_save() {
        let dir = tmp_dir("examples-malformed-item");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - name: Broken\n    input: 123\n    weird_nested:\n      foo: bar\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let mut metadata = document.summary.metadata.clone();
        metadata.notes = Some("added notes".into());
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("input: 123") && saved.contains("weird_nested"),
            "malformed item fields must not be dropped on an unrelated save, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_non_json_representable_yaml_survives_an_unrelated_save() {
        let dir = tmp_dir("examples-non-json");
        // A nested mapping whose key is a YAML sequence cannot be represented as
        // a JSON object key; the raw AST carrier must keep it regardless of JSON
        // representability (Issue #24 P0).
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - input: hello\n    custom:\n      ? [a, b]\n      : preserve-me\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        assert!(
            document.summary.metadata.examples_raw.is_some(),
            "raw carrier must exist even for non-JSON-representable YAML"
        );
        let before = document.summary.metadata.examples_raw.clone().unwrap();
        // An unrelated metadata save must keep the full raw YAML semantics.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        // Lexical formatting is not preserved (the sequence key may re-emit as a
        // block list instead of flow `[a, b]`) — only semantics are. The value
        // and the sequence-key members must survive; the strongest proof is the
        // raw AST being equal across the save below.
        assert!(
            saved.contains("preserve-me"),
            "sequence-key example value must survive an unrelated save, got:\n{saved}"
        );
        let reread = read_prompt(&dir, "p").unwrap();
        assert_eq!(
            reread.summary.metadata.examples_raw.as_ref(),
            Some(&before),
            "raw examples semantics (AST) must be stable across an unrelated save"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_unserializable_yaml_save_fails_instead_of_dropping_data() {
        let dir = tmp_dir("examples-unserializable");
        // A tagged value used as a mapping key is parsed fine by serde_yaml but
        // cannot be re-emitted by serde_yaml's serializer ("expected SCALAR,
        // SEQUENCE-START, ..."). The raw AST retains it without a failure path;
        // an unrelated metadata save that would have to rewrite the frontmatter
        // must FAIL (leaving the file untouched) rather than fall back to the
        // typed projection and drop the custom YAML (Issue #24 P0).
        let original = "---\nexamples:\n  - ? !Tag key\n    : value\n---\nbody\n";
        write(&dir, "p.md", original);
        let document = read_prompt(&dir, "p").unwrap();
        assert!(
            document.summary.metadata.examples_raw.is_some(),
            "raw AST must retain the tagged-key examples"
        );
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        let result = save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        );
        assert!(
            result.is_err(),
            "an unrelated save that cannot re-emit the examples must fail, not drop them"
        );
        assert_eq!(
            fs::read_to_string(dir.join("p.md")).unwrap(),
            original,
            "the file must be left untouched when the save fails"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_raw_i64_u64_survive_json_round_trip_as_strings() {
        let dir = tmp_dir("examples-int-ipc");
        // 9007199254740993 = 2^53 + 1 (a JS number silently coerces it to
        // 9007199254740992); 18446744073709551615 = u64::MAX. Both must survive
        // the IPC JSON round trip exactly, or an unrelated metadata save would
        // silently rewrite the user's YAML (Issue #24 P0).
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - input: hello\n    custom: 9007199254740993\n    custom2: 18446744073709551615\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let raw = document.summary.metadata.examples_raw.clone().unwrap();
        // The JSON form must carry the integers as exact decimal strings.
        let json_text = serde_json::to_string(&raw).unwrap();
        assert!(
            json_text.contains("9007199254740993"),
            "i64 must be carried verbatim as a decimal string, got: {json_text}"
        );
        assert!(
            json_text.contains("18446744073709551615"),
            "u64 must be carried verbatim, got: {json_text}"
        );
        // Simulating the IPC return path: a JSON round trip must reproduce the AST.
        let back: RawYaml = serde_json::from_str(&json_text).unwrap();
        assert_eq!(back, raw, "raw AST must survive a JSON round trip exactly");
        // And an unrelated metadata save re-emits the exact integers.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains("9007199254740993") && saved.contains("18446744073709551615"),
            "large integers must survive an unrelated save verbatim, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_raw_f64_special_values_round_trip_via_bits() {
        let dir = tmp_dir("examples-f64-ipc");
        write(
            &dir,
            "p.md",
            "---\nexamples:\n  - a: .nan\n    b: .inf\n    c: -.inf\n    d: -0.0\n    e: 1.5\n---\nbody\n",
        );
        let document = read_prompt(&dir, "p").unwrap();
        let raw = document.summary.metadata.examples_raw.clone().unwrap();
        // Floats travel as IEEE-754 bit strings, so NaN / ±Inf / −0.0 never hit
        // JSON floating-point semantics; a JSON round trip is lossless.
        let json_text = serde_json::to_string(&raw).unwrap();
        let back: RawYaml = serde_json::from_str(&json_text).unwrap();
        assert_eq!(back, raw, "f64 bits must survive a JSON round trip exactly");
        // An unrelated save re-emits them as readable YAML scalar tags.
        let mut metadata = document.summary.metadata.clone();
        metadata.description = "edited".into();
        save_prompt(
            &dir,
            "p",
            "body\n",
            &metadata,
            document.frontmatter_prefix.as_deref(),
            true,
            Some(&document.raw),
        )
        .unwrap();
        let saved = fs::read_to_string(dir.join("p.md")).unwrap();
        assert!(
            saved.contains(".nan") && saved.contains(".inf") && saved.contains("-0.0"),
            "special float values must survive an unrelated save, got:\n{saved}"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_body_only_save_does_not_reformat_the_frontmatter() {
        let dir = tmp_dir("examples-body-save");
        let raw = "---\nexamples:\n  - name: A\n    input: in\n---\nbody {a}\n";
        write(&dir, "p.md", raw);
        let document = read_prompt(&dir, "p").unwrap();
        save_prompt(
            &dir,
            "p",
            "changed {a}\n",
            &document.summary.metadata,
            document.frontmatter_prefix.as_deref(),
            false,
            Some(&document.raw),
        )
        .unwrap();
        // Non-dirty body save keeps the exact original frontmatter prefix bytes.
        assert_eq!(
            fs::read_to_string(dir.join("p.md")).unwrap(),
            "---\nexamples:\n  - name: A\n    input: in\n---\nchanged {a}\n"
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn examples_save_still_refuses_to_overwrite_an_external_change() {
        let dir = tmp_dir("examples-conflict");
        let mut metadata = PromptMetadata::default();
        metadata.examples = Some(vec![PromptExample {
            name: Some("A".into()),
            input: Some("in".into()),
            ..PromptExample::default()
        }]);
        create_prompt(&dir, "p", "body", &metadata).unwrap();
        let document = read_prompt(&dir, "p").unwrap();
        fs::write(dir.join("p.md"), "external edit").unwrap();
        let mut changed = document.summary.metadata.clone();
        changed.notes = Some("local note".into());
        let error = save_prompt(
            &dir,
            "p",
            "body",
            &changed,
            document.frontmatter_prefix.as_deref(),
            true,
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
    fn existing_regular_asset_resolves() {
        let dir = tmp_dir("asset-resolved");
        write(&dir, "assets/reference.png", "image-bytes");
        let result = resolve_prompt_assets(&dir, &["assets/reference.png".to_string()]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].state, AssetResolutionState::Resolved);
        assert_eq!(result[0].kind, Some(AssetKind::Image));
        assert_eq!(result[0].size_bytes, Some("image-bytes".len() as u64));
        assert!(result[0].modified_at.is_some());
        assert_eq!(result[0].error, None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nested_unicode_asset_resolves() {
        let dir = tmp_dir("asset-unicode");
        write(&dir, "示例/引用-图片.png", "x");
        let result = resolve_prompt_assets(&dir, &["示例/引用-图片.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Resolved);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_safe_path_is_missing_not_invalid() {
        let dir = tmp_dir("asset-missing");
        let result = resolve_prompt_assets(&dir, &["assets/never-created.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Missing);
        assert_eq!(result[0].error, None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn absolute_path_is_invalid() {
        let dir = tmp_dir("asset-absolute");
        let result = resolve_prompt_assets(&dir, &["/tmp/foo.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        assert!(result[0].error.is_some());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn parent_escape_is_invalid() {
        let dir = tmp_dir("asset-escape");
        let result = resolve_prompt_assets(&dir, &["../foo.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nested_dotdot_is_invalid() {
        let dir = tmp_dir("asset-dotdot");
        let result = resolve_prompt_assets(&dir, &["a/../../foo.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn windows_drive_prefix_is_invalid() {
        let dir = tmp_dir("asset-windows");
        for reference in ["C:\\foo.png", "C:/foo.png"] {
            let result = resolve_prompt_assets(&dir, &[reference.to_string()]);
            assert_eq!(
                result[0].state,
                AssetResolutionState::Invalid,
                "{reference}"
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn markdown_reference_is_invalid_case_insensitive() {
        let dir = tmp_dir("asset-md");
        for reference in ["foo.md", "nested/foo.MD", ".md"] {
            let result = resolve_prompt_assets(&dir, &[reference.to_string()]);
            assert_eq!(
                result[0].state,
                AssetResolutionState::Invalid,
                "{reference}"
            );
            let message = result[0].error.as_deref().unwrap_or_default();
            assert!(message.contains("Markdown prompt"), "{message}");
        }
        // Even an existing file with a `.md` leaf must be refused: the scanner
        // invariant makes it a Prompt by identity, never an asset.
        write(&dir, "existing.md", "x");
        let result = resolve_prompt_assets(&dir, &["existing.md".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn directory_target_is_invalid() {
        let dir = tmp_dir("asset-dir");
        fs::create_dir_all(dir.join("assets")).unwrap();
        let result = resolve_prompt_assets(&dir, &["assets".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        let message = result[0].error.as_deref().unwrap_or_default();
        assert!(message.contains("not a regular file"), "{message}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_file_is_invalid() {
        use std::os::unix::fs::symlink;
        let dir = tmp_dir("asset-symlink-file");
        write(&dir, "real.png", "x");
        symlink(dir.join("real.png"), dir.join("link.png")).unwrap();
        let result = resolve_prompt_assets(&dir, &["link.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        let message = result[0].error.as_deref().unwrap_or_default();
        assert!(message.contains("symlink"), "{message}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn path_traversing_symlinked_directory_is_invalid() {
        use std::os::unix::fs::symlink;
        let dir = tmp_dir("asset-symlink-dir");
        fs::create_dir_all(dir.join("real")).unwrap();
        write(&dir, "real/inside.png", "x");
        symlink(dir.join("real"), dir.join("alias")).unwrap();
        let result = resolve_prompt_assets(&dir, &["alias/inside.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn broken_symlink_is_invalid_not_missing() {
        use std::os::unix::fs::symlink;
        let dir = tmp_dir("asset-symlink-broken");
        symlink(dir.join("does-not-exist.png"), dir.join("broken.png")).unwrap();
        let result = resolve_prompt_assets(&dir, &["broken.png".to_string()]);
        assert_eq!(result[0].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn batch_resolver_isolates_bad_references() {
        let dir = tmp_dir("asset-batch");
        write(&dir, "ok.png", "x");
        let results = resolve_prompt_assets(
            &dir,
            &[
                "ok.png".to_string(),
                "missing.png".to_string(),
                "../escape.png".to_string(),
                "bad.md".to_string(),
            ],
        );
        assert_eq!(results.len(), 4);
        assert_eq!(results[0].state, AssetResolutionState::Resolved);
        assert_eq!(results[1].state, AssetResolutionState::Missing);
        assert_eq!(results[2].state, AssetResolutionState::Invalid);
        assert_eq!(results[3].state, AssetResolutionState::Invalid);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn same_reference_resolves_independently_per_project() {
        let a = tmp_dir("asset-proj-a");
        let b = tmp_dir("asset-proj-b");
        write(&a, "assets/ref.png", "a");
        write(&b, "assets/ref.png", "b");
        let result_a = resolve_prompt_assets(&a, &["assets/ref.png".to_string()]);
        let result_b = resolve_prompt_assets(&b, &["assets/ref.png".to_string()]);
        assert_eq!(result_a[0].state, AssetResolutionState::Resolved);
        assert_eq!(result_a[0].size_bytes, Some(1));
        assert_eq!(result_b[0].state, AssetResolutionState::Resolved);
        assert_eq!(result_b[0].size_bytes, Some(1));
        // A reference that exists only in A stays missing in B (never leaks).
        write(&a, "only-a.png", "x");
        let result_b_missing = resolve_prompt_assets(&b, &["only-a.png".to_string()]);
        assert_eq!(result_b_missing[0].state, AssetResolutionState::Missing);
        fs::remove_dir_all(a).unwrap();
        fs::remove_dir_all(b).unwrap();
    }

    #[test]
    fn asset_kind_hint_follows_extension() {
        let dir = tmp_dir("asset-kind");
        for (reference, expected) in [
            ("img.png", AssetKind::Image),
            ("doc.pdf", AssetKind::Pdf),
            ("data.json", AssetKind::Json),
            ("notes.txt", AssetKind::Text),
            ("archive.zip", AssetKind::Binary),
        ] {
            write(&dir, reference, "x");
            let result = resolve_prompt_assets(&dir, &[reference.to_string()]);
            assert_eq!(
                result[0].state,
                AssetResolutionState::Resolved,
                "{reference}"
            );
            assert_eq!(result[0].kind, Some(expected), "{reference}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reveal_requires_existing_regular_file() {
        let dir = tmp_dir("asset-reveal-ok");
        write(&dir, "assets/ok.png", "x");
        let path = asset_absolute_path_for_reveal(&dir, "assets/ok.png").unwrap();
        assert!(path.is_file());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reveal_fails_closed_for_unsafe_or_missing_targets() {
        let dir = tmp_dir("asset-reveal-bad");
        write(&dir, "ok.png", "x");
        fs::create_dir_all(dir.join("assets")).unwrap();
        for reference in [
            "../escape.png",
            "/tmp/foo.png",
            "missing.png",
            "bad.md",
            "assets", // directory target
        ] {
            let error = asset_absolute_path_for_reveal(&dir, reference).unwrap_err();
            assert!(!error.is_empty(), "{reference}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    // ── Issue #26 picker seam: asset_reference_from_selected_path ────────────

    #[test]
    fn selected_file_inside_project_becomes_a_canonical_relative_reference() {
        let dir = tmp_dir("picker-inside");
        write(&dir, "assets/reference.png", "x");
        let absolute = dir.join("assets/reference.png").canonicalize().unwrap();
        let reference =
            asset_reference_from_selected_path(&dir, &absolute.to_string_lossy()).unwrap();
        assert_eq!(reference, "assets/reference.png");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_file_outside_project_is_rejected() {
        let dir = tmp_dir("picker-outside");
        let outside = tmp_dir("picker-outside-target");
        write(&outside, "sibling.png", "x");
        fs::create_dir_all(dir.join("assets")).unwrap();
        let absolute = outside.join("sibling.png").canonicalize().unwrap();
        let error =
            asset_reference_from_selected_path(&dir, &absolute.to_string_lossy()).unwrap_err();
        assert!(error.contains("outside the current Project"), "{error}");
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn selected_markdown_or_non_regular_or_relative_path_is_rejected() {
        let dir = tmp_dir("picker-invalid");
        write(&dir, "prompt.md", "# hi");
        write(&dir, "data.json", "{}");
        fs::create_dir_all(dir.join("assets")).unwrap();
        // A `.md` file is a prompt by identity and can never be an asset.
        let md = dir.join("prompt.md").canonicalize().unwrap();
        let error = asset_reference_from_selected_path(&dir, &md.to_string_lossy()).unwrap_err();
        assert!(error.contains("Markdown prompt"), "{error}");
        // A directory is not a regular file.
        let folder = dir.join("assets").canonicalize().unwrap();
        let error =
            asset_reference_from_selected_path(&dir, &folder.to_string_lossy()).unwrap_err();
        assert!(!error.is_empty(), "directory must be rejected");
        // A non-absolute path cannot be a file-dialog selection.
        let error = asset_reference_from_selected_path(&dir, "assets/reference.png").unwrap_err();
        assert!(error.contains("not absolute"), "{error}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_symlink_resolving_outside_project_is_rejected() {
        let dir = tmp_dir("picker-symlink-outside");
        let outside = tmp_dir("picker-symlink-outside-target");
        write(&outside, "secret.png", "x");
        fs::create_dir_all(dir.join("assets")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = dir.join("assets/link.png");
            symlink(&outside.join("secret.png"), &link).unwrap();
            let error =
                asset_reference_from_selected_path(&dir, &link.to_string_lossy()).unwrap_err();
            // The symlink component is rejected before any canonicalization, so
            // the selected path is refused outright — the escape is never
            // resolved and never silently accepted.
            assert!(error.contains("symlink"), "{error}");
        }
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn selected_symlink_resolving_inside_project_is_rejected() {
        let dir = tmp_dir("picker-symlink-inside");
        write(&dir, "assets/real.png", "x");
        fs::create_dir_all(dir.join("assets")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            // A Project-internal symlink must be refused just like a hand-written
            // reference (Issue #25): selecting assets/link.png may never be
            // silently rewritten into assets/real.png by canonicalization.
            let link = dir.join("assets/link.png");
            symlink(&dir.join("assets/real.png"), &link).unwrap();
            let error =
                asset_reference_from_selected_path(&dir, &link.to_string_lossy()).unwrap_err();
            assert!(error.contains("symlink"), "{error}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn selected_file_under_symlinked_project_root_is_accepted() {
        let dir = tmp_dir("picker-root-link");
        write(&dir, "assets/x.png", "x");
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            // A project whose own registered root is a symlink must keep working:
            // the selection is stripped against both the canonical root and the
            // registered (possibly symlinked) path, and no asset-level symlink is
            // involved, so the reference is accepted.
            let link_dir = std::env::temp_dir().join(format!(
                "promptarium-library-test-picker-root-link-alias-{}",
                uuid::Uuid::new_v4()
            ));
            symlink(&dir, &link_dir).unwrap();
            let selected = link_dir.join("assets/x.png");
            let reference =
                asset_reference_from_selected_path(&link_dir, &selected.to_string_lossy()).unwrap();
            assert_eq!(reference, "assets/x.png");
            fs::remove_dir_all(&link_dir).unwrap();
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn selected_unix_literal_backslash_filename_fails_closed() {
        // On Unix/macOS `\` is a real filename character. Selecting a file
        // literally named `a\b.png` must fail closed — never be silently
        // rewritten into `assets/a/b.png`, a reference that points at a
        // different file than the user selected (Issue #30 P3).
        let dir = tmp_dir("picker-backslash");
        write(&dir, "assets/a\\b.png", "x");
        let absolute = dir.join("assets/a\\b.png").canonicalize().unwrap();
        let error =
            asset_reference_from_selected_path(&dir, &absolute.to_string_lossy()).unwrap_err();
        assert!(error.contains("literal"), "{error}");
        assert!(!error.contains("assets/a/b.png"), "{error}");
        fs::remove_dir_all(dir).unwrap();
    }
}
