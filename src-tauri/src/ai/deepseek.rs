use std::collections::HashSet;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use keyring::{Entry, Error as KeyringError};

const KEYCHAIN_SERVICE: &str = "com.shadyunderlight.promptarium";
const KEYCHAIN_ACCOUNT: &str = "deepseek-api-key";
const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODELS_ENDPOINT: &str = "https://api.deepseek.com/models";
// 当前 V4.1 Flash 的官方 API 名；deepseek-v4-flash 仅是兼容旧别名。
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-flash";
const MAX_CANDIDATE_CHARS: usize = 80;
const MAX_MODEL_ID_CHARS: usize = 128;

const SYSTEM_PROMPT: &str = r#"你是 Promptarium 的文件命名助手。

根据用户提供的 Prompt 内容，生成 3 个简洁、自然、容易识别的简体中文文件名候选。

要求：
- 只概括这个 Prompt 的用途
- 每个候选尽量简短，通常 4～12 个中文字符左右
- 可以保留必要的英文技术词或缩写，例如 GitHub、PR、API、JSON、Python、Rust、SQL
- 不要带 .md
- 不要生成目录
- 不要使用 / 或 \
- 不要使用文件系统非法字符
- 不要解释
- 3 个候选之间应有一定区别
- 返回严格 JSON：
{"names":["名称1","名称2","名称3"]}"#;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiNamingFailure {
    NotConfigured,
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    EmptyPrompt,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    CredentialStore,
    AuthFailed,
    RateLimited,
    InsufficientBalance,
    Network,
    Timeout,
    BadResponse,
    OutputLimit,
    InvalidSettings,
    ServiceError,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReasoningEffort {
    None,
    Low,
    High,
    Max,
}

impl ReasoningEffort {
    fn api_value(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Low => Some("low"),
            Self::High => Some("high"),
            Self::Max => Some("max"),
        }
    }

    fn max_tokens(self) -> u16 {
        match self {
            Self::None => 128,
            Self::Low => 512,
            Self::High => 1024,
            Self::Max => 2048,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CredentialFailure {
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    EmptyKey,
    Store,
}

#[derive(Debug, Serialize)]
pub struct DeepSeekCredentialStatus {
    pub configured: bool,
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<CredentialFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CredentialMutationResult {
    pub status: DeepSeekCredentialStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<CredentialFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FilenameSuggestionResult {
    pub names: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<AiNamingFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeepSeekModelListResult {
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<AiNamingFailure>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: [ChatMessage<'a>; 2],
    response_format: ResponseFormat,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'static str>,
    stream: bool,
    max_tokens: u16,
}

#[derive(Debug, Serialize)]
struct ChatMessage<'a> {
    role: &'static str,
    content: &'a str,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct Thinking {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NamesPayload {
    names: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsPayload {
    data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelEntry {
    id: String,
}

fn success(names: Vec<String>) -> FilenameSuggestionResult {
    FilenameSuggestionResult {
        names,
        failure: None,
        detail: None,
    }
}

fn failure(code: AiNamingFailure, detail: Option<&str>) -> FilenameSuggestionResult {
    FilenameSuggestionResult {
        names: Vec::new(),
        failure: Some(code),
        detail: detail.map(str::to_owned),
    }
}

fn model_list_success(models: Vec<String>) -> DeepSeekModelListResult {
    DeepSeekModelListResult {
        models,
        failure: None,
        detail: None,
    }
}

fn model_list_failure(code: AiNamingFailure, detail: Option<&str>) -> DeepSeekModelListResult {
    DeepSeekModelListResult {
        models: Vec::new(),
        failure: Some(code),
        detail: detail.map(str::to_owned),
    }
}

fn supported_status(configured: bool) -> DeepSeekCredentialStatus {
    DeepSeekCredentialStatus {
        configured,
        supported: true,
        failure: None,
        detail: None,
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn unsupported_status() -> DeepSeekCredentialStatus {
    DeepSeekCredentialStatus {
        configured: false,
        supported: false,
        failure: Some(CredentialFailure::Unsupported),
        detail: None,
    }
}

fn credential_store_status(detail: &'static str) -> DeepSeekCredentialStatus {
    DeepSeekCredentialStatus {
        configured: false,
        supported: true,
        failure: Some(CredentialFailure::Store),
        detail: Some(detail.to_owned()),
    }
}

fn credential_result(
    status: DeepSeekCredentialStatus,
    failure: Option<CredentialFailure>,
    detail: Option<&'static str>,
) -> CredentialMutationResult {
    CredentialMutationResult {
        status,
        failure,
        detail: detail.map(str::to_owned),
    }
}

#[cfg(target_os = "macos")]
fn keychain_entry() -> Result<Entry, KeyringError> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
}

#[cfg(target_os = "macos")]
fn credential_status_sync() -> DeepSeekCredentialStatus {
    let entry = match keychain_entry() {
        Ok(entry) => entry,
        Err(_) => return credential_store_status("macOS Keychain is unavailable"),
    };
    match entry.get_password() {
        Ok(secret) => supported_status(!secret.trim().is_empty()),
        Err(KeyringError::NoEntry) => supported_status(false),
        Err(_) => credential_store_status("macOS Keychain could not be accessed"),
    }
}

#[cfg(target_os = "macos")]
fn stored_api_key() -> Result<Option<String>, KeyringError> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(secret) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) => Ok(None),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn set_api_key_sync(secret: &str) -> CredentialMutationResult {
    let entry = match keychain_entry() {
        Ok(entry) => entry,
        Err(_) => {
            return credential_result(
                credential_store_status("macOS Keychain is unavailable"),
                Some(CredentialFailure::Store),
                Some("macOS Keychain is unavailable"),
            );
        }
    };
    match entry.set_password(secret) {
        Ok(()) => credential_result(supported_status(true), None, None),
        Err(_) => credential_result(
            credential_store_status("macOS Keychain could not save the API key"),
            Some(CredentialFailure::Store),
            Some("macOS Keychain could not save the API key"),
        ),
    }
}

#[cfg(target_os = "macos")]
fn clear_api_key_sync() -> CredentialMutationResult {
    let entry = match keychain_entry() {
        Ok(entry) => entry,
        Err(_) => {
            return credential_result(
                credential_store_status("macOS Keychain is unavailable"),
                Some(CredentialFailure::Store),
                Some("macOS Keychain is unavailable"),
            );
        }
    };
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => {
            credential_result(supported_status(false), None, None)
        }
        Err(_) => credential_result(
            credential_store_status("macOS Keychain could not clear the API key"),
            Some(CredentialFailure::Store),
            Some("macOS Keychain could not clear the API key"),
        ),
    }
}

#[tauri::command]
pub async fn deepseek_credential_status() -> DeepSeekCredentialStatus {
    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(credential_status_sync)
            .await
            .unwrap_or_else(|_| credential_store_status("macOS Keychain is unavailable"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        unsupported_status()
    }
}

#[tauri::command]
pub async fn set_deepseek_api_key(api_key: String) -> CredentialMutationResult {
    let secret = api_key.trim().to_owned();
    if secret.is_empty() {
        #[cfg(target_os = "macos")]
        {
            return credential_result(
                supported_status(false),
                Some(CredentialFailure::EmptyKey),
                Some("API key cannot be empty"),
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            return credential_result(
                unsupported_status(),
                Some(CredentialFailure::EmptyKey),
                Some("API key cannot be empty"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(move || set_api_key_sync(&secret))
            .await
            .unwrap_or_else(|_| {
                credential_result(
                    credential_store_status("macOS Keychain is unavailable"),
                    Some(CredentialFailure::Store),
                    Some("macOS Keychain is unavailable"),
                )
            });
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = secret;
        credential_result(
            unsupported_status(),
            Some(CredentialFailure::Unsupported),
            Some("DeepSeek credentials are supported only on macOS"),
        )
    }
}

#[tauri::command]
pub async fn clear_deepseek_api_key() -> CredentialMutationResult {
    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(clear_api_key_sync)
            .await
            .unwrap_or_else(|_| {
                credential_result(
                    credential_store_status("macOS Keychain is unavailable"),
                    Some(CredentialFailure::Store),
                    Some("macOS Keychain is unavailable"),
                )
            });
    }

    #[cfg(not(target_os = "macos"))]
    {
        credential_result(
            unsupported_status(),
            Some(CredentialFailure::Unsupported),
            Some("DeepSeek credentials are supported only on macOS"),
        )
    }
}

#[tauri::command]
pub async fn list_deepseek_models() -> DeepSeekModelListResult {
    #[cfg(not(target_os = "macos"))]
    {
        return model_list_failure(AiNamingFailure::Unsupported, None);
    }

    #[cfg(target_os = "macos")]
    {
        let api_key = match tauri::async_runtime::spawn_blocking(stored_api_key).await {
            Ok(Ok(Some(api_key))) => api_key,
            Ok(Ok(None)) => {
                return model_list_failure(AiNamingFailure::NotConfigured, None);
            }
            Ok(Err(_)) | Err(_) => {
                return model_list_failure(
                    AiNamingFailure::CredentialStore,
                    Some("macOS Keychain could not be accessed"),
                );
            }
        };
        request_models(&api_key).await
    }
}

#[tauri::command]
pub async fn generate_prompt_filename_suggestions(
    body: String,
    model: String,
    reasoning_effort: ReasoningEffort,
) -> FilenameSuggestionResult {
    if body.trim().is_empty() {
        return failure(AiNamingFailure::EmptyPrompt, None);
    }
    let model = if model.trim().is_empty() {
        DEFAULT_DEEPSEEK_MODEL.to_owned()
    } else {
        model
    };
    if !valid_model_id(&model) {
        return failure(AiNamingFailure::InvalidSettings, Some("invalid model id"));
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = body;
        let _ = model;
        let _ = reasoning_effort;
        return failure(AiNamingFailure::Unsupported, None);
    }

    #[cfg(target_os = "macos")]
    {
        let api_key = match tauri::async_runtime::spawn_blocking(stored_api_key).await {
            Ok(Ok(Some(api_key))) => api_key,
            Ok(Ok(None)) => return failure(AiNamingFailure::NotConfigured, None),
            Ok(Err(_)) | Err(_) => {
                return failure(
                    AiNamingFailure::CredentialStore,
                    Some("macOS Keychain could not be accessed"),
                )
            }
        };
        request_suggestions(&api_key, &body, &model, reasoning_effort).await
    }
}

async fn request_models(api_key: &str) -> DeepSeekModelListResult {
    let client = match Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return model_list_failure(AiNamingFailure::Network, Some("request client unavailable"))
        }
    };

    let response = match client
        .get(DEEPSEEK_MODELS_ENDPOINT)
        .bearer_auth(api_key)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return model_list_failure(map_transport_error(error.is_timeout()), None);
        }
    };

    let status = response.status();
    if !status.is_success() {
        return model_list_failure(
            map_http_status(status),
            Some(&format!("DeepSeek HTTP status {}", status.as_u16())),
        );
    }

    let response = match response.json::<ModelsPayload>().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return model_list_failure(AiNamingFailure::Timeout, None)
        }
        Err(_) => {
            return model_list_failure(AiNamingFailure::BadResponse, Some("invalid JSON response"))
        }
    };

    match parse_model_ids(response) {
        Ok(models) => model_list_success(models),
        Err(code) => model_list_failure(code, Some("response did not contain model ids")),
    }
}

async fn request_suggestions(
    api_key: &str,
    body: &str,
    model: &str,
    reasoning_effort: ReasoningEffort,
) -> FilenameSuggestionResult {
    let client = match Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(_) => return failure(AiNamingFailure::Network, Some("request client unavailable")),
    };

    let response = match client
        .post(DEEPSEEK_ENDPOINT)
        .bearer_auth(api_key)
        .json(&build_chat_request(body, model, reasoning_effort))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return failure(map_transport_error(error.is_timeout()), None);
        }
    };

    let status = response.status();
    if !status.is_success() {
        return failure(
            map_http_status(status),
            Some(&format!("DeepSeek HTTP status {}", status.as_u16())),
        );
    }

    let response = match response.json::<ChatResponse>().await {
        Ok(response) => response,
        Err(error) if error.is_timeout() => return failure(AiNamingFailure::Timeout, None),
        Err(_) => return failure(AiNamingFailure::BadResponse, Some("invalid JSON response")),
    };
    let content = match chat_content(&response) {
        Ok(content) => content,
        Err(AiNamingFailure::OutputLimit) => {
            return failure(
                AiNamingFailure::OutputLimit,
                Some("response reached the selected max_tokens budget"),
            )
        }
        Err(code) => return failure(code, Some("missing response content")),
    };

    match parse_filename_suggestions(content) {
        Ok(names) => success(names),
        Err(code) => failure(code, Some("response did not contain three valid names")),
    }
}

fn chat_content(response: &ChatResponse) -> Result<&str, AiNamingFailure> {
    let choice = response
        .choices
        .first()
        .ok_or(AiNamingFailure::BadResponse)?;
    if choice.finish_reason.as_deref() == Some("length") {
        return Err(AiNamingFailure::OutputLimit);
    }
    choice
        .message
        .content
        .as_deref()
        .ok_or(AiNamingFailure::BadResponse)
}

fn build_chat_request<'a>(
    body: &'a str,
    model: &'a str,
    reasoning_effort: ReasoningEffort,
) -> ChatRequest<'a> {
    ChatRequest {
        model,
        messages: [
            ChatMessage {
                role: "system",
                content: SYSTEM_PROMPT,
            },
            ChatMessage {
                role: "user",
                content: body,
            },
        ],
        response_format: ResponseFormat {
            kind: "json_object",
        },
        thinking: (reasoning_effort == ReasoningEffort::None)
            .then_some(Thinking { kind: "disabled" }),
        reasoning_effort: reasoning_effort.api_value(),
        stream: false,
        max_tokens: reasoning_effort.max_tokens(),
    }
}

fn parse_filename_suggestions(content: &str) -> Result<Vec<String>, AiNamingFailure> {
    let payload: NamesPayload =
        serde_json::from_str(content).map_err(|_| AiNamingFailure::BadResponse)?;
    let mut seen = HashSet::new();
    let mut names = Vec::new();
    for raw in payload.names {
        let Some(name) = sanitize_candidate(&raw) else {
            continue;
        };
        if seen.insert(name.clone()) {
            names.push(name);
        }
    }
    if names.len() < 3 {
        return Err(AiNamingFailure::BadResponse);
    }
    names.truncate(3);
    Ok(names)
}

fn parse_model_ids(payload: ModelsPayload) -> Result<Vec<String>, AiNamingFailure> {
    let mut seen = HashSet::new();
    let mut models = Vec::new();
    for entry in payload.data {
        let model = entry.id.trim();
        if valid_model_id(model) && seen.insert(model.to_owned()) {
            models.push(model.to_owned());
        }
    }
    if models.is_empty() {
        return Err(AiNamingFailure::BadResponse);
    }
    Ok(models)
}

fn valid_model_id(model: &str) -> bool {
    !model.is_empty()
        && model.chars().count() <= MAX_MODEL_ID_CHARS
        && model
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

fn sanitize_candidate(raw: &str) -> Option<String> {
    let mut value = raw.trim().to_owned();
    if value.len() >= 2 {
        let first = value.chars().next()?;
        let last = value.chars().last()?;
        if matching_quotes(first, last) {
            let first_len = first.len_utf8();
            let last_len = last.len_utf8();
            value = value[first_len..value.len() - last_len].to_owned();
        }
    }
    value = value.trim().to_owned();
    if value
        .len()
        .checked_sub(3)
        .and_then(|start| value.get(start..))
        .is_some_and(|suffix| suffix.eq_ignore_ascii_case(".md"))
    {
        value.truncate(value.len() - 3);
        value = value.trim().to_owned();
    }

    if value.is_empty()
        || value == "."
        || value == ".."
        || value.chars().count() > MAX_CANDIDATE_CHARS
        || value.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '<' | '>' | '|' | '"'
                )
        })
    {
        return None;
    }
    Some(value)
}

fn matching_quotes(first: char, last: char) -> bool {
    matches!(
        (first, last),
        ('"', '"') | ('\'', '\'') | ('“', '”') | ('‘', '’')
    )
}

fn map_http_status(status: StatusCode) -> AiNamingFailure {
    match status {
        StatusCode::PAYMENT_REQUIRED => AiNamingFailure::InsufficientBalance,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => AiNamingFailure::AuthFailed,
        StatusCode::TOO_MANY_REQUESTS => AiNamingFailure::RateLimited,
        status if status.is_server_error() => AiNamingFailure::ServiceError,
        _ => AiNamingFailure::ServiceError,
    }
}

fn map_transport_error(is_timeout: bool) -> AiNamingFailure {
    if is_timeout {
        AiNamingFailure::Timeout
    } else {
        AiNamingFailure::Network
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_contract_uses_non_thinking_json_mode() {
        let request = serde_json::to_value(build_chat_request(
            "Review this PR.",
            DEFAULT_DEEPSEEK_MODEL,
            ReasoningEffort::None,
        ))
        .unwrap();
        assert_eq!(
            DEEPSEEK_ENDPOINT,
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(request["model"], "deepseek-flash");
        assert_ne!(request["model"], "deepseek-v4-flash");
        assert_eq!(request["thinking"]["type"], "disabled");
        assert_eq!(request["response_format"]["type"], "json_object");
        assert_eq!(request["stream"], false);
        assert_eq!(request["max_tokens"], 128);
        assert_eq!(request["messages"][1]["content"], "Review this PR.");
        assert!(request.get("reasoning_effort").is_none());
    }

    #[test]
    fn request_contract_supports_selected_model_and_reasoning_effort() {
        let low = serde_json::to_value(build_chat_request(
            "Review this PR.",
            "deepseek-flash",
            ReasoningEffort::Low,
        ))
        .unwrap();
        assert_eq!(low["reasoning_effort"], "low");
        assert_eq!(low["max_tokens"], 512);
        assert!(low.get("thinking").is_none());

        let request = serde_json::to_value(build_chat_request(
            "Review this PR.",
            "deepseek-v4-pro",
            ReasoningEffort::High,
        ))
        .unwrap();
        assert_eq!(request["model"], "deepseek-v4-pro");
        assert!(request.get("thinking").is_none());
        assert_eq!(request["reasoning_effort"], "high");
        assert_eq!(request["max_tokens"], 1024);

        let max = serde_json::to_value(build_chat_request(
            "Review this PR.",
            "deepseek-v4-pro",
            ReasoningEffort::Max,
        ))
        .unwrap();
        assert_eq!(max["reasoning_effort"], "max");
        assert_eq!(max["max_tokens"], 2048);
    }

    #[test]
    fn length_finish_reason_maps_to_output_limit() {
        let response: ChatResponse = serde_json::from_str(
            r#"{"choices":[{"message":{"content":null},"finish_reason":"length"}]}"#,
        )
        .unwrap();
        assert_eq!(chat_content(&response), Err(AiNamingFailure::OutputLimit));
    }

    #[test]
    fn model_list_response_is_trimmed_and_deduplicated() {
        let payload: ModelsPayload = serde_json::from_str(
            r#"{"data":[{"id":" deepseek-flash "},{"id":"deepseek-flash"},{"id":"deepseek-v4-pro"},{"id":"bad\nmodel"},{"id":""}]}"#,
        )
        .unwrap();
        assert_eq!(
            parse_model_ids(payload).unwrap(),
            vec!["deepseek-flash", "deepseek-v4-pro"]
        );
        assert_eq!(DEEPSEEK_MODELS_ENDPOINT, "https://api.deepseek.com/models");
    }

    #[test]
    fn valid_json_response_is_parsed_and_duplicates_are_removed() {
        let names = parse_filename_suggestions(
            r#"{"names":["PR 代码审查","PR 代码审查","GitHub API 测试","Rust Unsafe 审查","额外候选"]}"#,
        )
        .unwrap();
        assert_eq!(
            names,
            vec!["PR 代码审查", "GitHub API 测试", "Rust Unsafe 审查"]
        );
    }

    #[test]
    fn malformed_json_or_too_few_valid_names_is_bad_response() {
        assert_eq!(
            parse_filename_suggestions(r#"{"names":["PR 代码审查"]}"#),
            Err(AiNamingFailure::BadResponse)
        );
        assert_eq!(
            parse_filename_suggestions(r#"not json"#),
            Err(AiNamingFailure::BadResponse)
        );
    }

    #[test]
    fn candidate_sanitization_preserves_chinese_and_removes_md_suffix() {
        assert_eq!(
            sanitize_candidate("  \"PR 代码审查.md\"  "),
            Some("PR 代码审查".to_owned())
        );
        assert_eq!(
            sanitize_candidate("GitHub API 测试"),
            Some("GitHub API 测试".to_owned())
        );
        assert_eq!(
            sanitize_candidate("Rust Unsafe 审查"),
            Some("Rust Unsafe 审查".to_owned())
        );
        assert_eq!(sanitize_candidate("AI🚀.md"), Some("AI🚀".to_owned()));
        assert_eq!(sanitize_candidate("测试é.md"), Some("测试é".to_owned()));
        assert_eq!(sanitize_candidate("AI🚀"), Some("AI🚀".to_owned()));
        assert_eq!(sanitize_candidate("测试é"), Some("测试é".to_owned()));
        assert_eq!(sanitize_candidate("🚀.md"), Some("🚀".to_owned()));
    }

    #[test]
    fn unsafe_leaf_candidates_are_rejected() {
        for candidate in [
            "../foo",
            "foo/bar",
            r"foo\bar",
            "/absolute",
            "foo:bar",
            ".",
            "..",
        ] {
            assert_eq!(sanitize_candidate(candidate), None, "{candidate}");
        }
        assert_eq!(sanitize_candidate("foo\0bar"), None);
    }

    #[test]
    fn http_failures_map_to_machine_codes() {
        assert_eq!(
            map_http_status(StatusCode::UNAUTHORIZED),
            AiNamingFailure::AuthFailed
        );
        assert_eq!(
            map_http_status(StatusCode::FORBIDDEN),
            AiNamingFailure::AuthFailed
        );
        assert_eq!(
            map_http_status(StatusCode::TOO_MANY_REQUESTS),
            AiNamingFailure::RateLimited
        );
        assert_eq!(
            map_http_status(StatusCode::PAYMENT_REQUIRED),
            AiNamingFailure::InsufficientBalance
        );
        assert_eq!(
            map_http_status(StatusCode::INTERNAL_SERVER_ERROR),
            AiNamingFailure::ServiceError
        );
        assert_eq!(map_transport_error(true), AiNamingFailure::Timeout);
        assert_eq!(map_transport_error(false), AiNamingFailure::Network);
    }

    #[test]
    fn credential_and_result_dtos_never_serialize_a_secret() {
        let status = serde_json::to_string(&supported_status(true)).unwrap();
        let result = serde_json::to_string(&CredentialMutationResult {
            status: DeepSeekCredentialStatus {
                configured: true,
                supported: true,
                failure: None,
                detail: None,
            },
            failure: None,
            detail: None,
        })
        .unwrap();
        assert!(status.contains("configured"));
        assert!(!status.contains("apiKey"));
        assert!(!result.contains("sk-"));
        assert!(!result.contains("password"));
    }
}
