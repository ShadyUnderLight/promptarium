use std::collections::HashSet;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.shadyunderlight.promptarium";
const KEYCHAIN_ACCOUNT: &str = "deepseek-api-key";
const DEEPSEEK_ENDPOINT: &str = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL: &str = "deepseek-flash";
const MAX_CANDIDATE_CHARS: usize = 80;

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
    AuthFailed,
    RateLimited,
    Network,
    Timeout,
    BadResponse,
    ServiceError,
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
struct ChatRequest<'a> {
    model: &'static str,
    messages: [ChatMessage<'a>; 2],
    response_format: ResponseFormat,
    thinking: Thinking,
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
}

#[derive(Debug, Deserialize)]
struct ChatMessageResponse {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NamesPayload {
    names: Vec<String>,
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

fn credential_success() -> CredentialMutationResult {
    CredentialMutationResult {
        status: deepseek_credential_status(),
        failure: None,
        detail: None,
    }
}

fn credential_failure(code: CredentialFailure, detail: &'static str) -> CredentialMutationResult {
    CredentialMutationResult {
        status: deepseek_credential_status(),
        failure: Some(code),
        detail: Some(detail.to_owned()),
    }
}

#[cfg(target_os = "macos")]
fn keychain_entry() -> Result<Entry, ()> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|_| ())
}

#[cfg(target_os = "macos")]
fn stored_api_key() -> Result<Option<String>, ()> {
    let entry = keychain_entry()?;
    match entry.get_password() {
        Ok(secret) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub fn deepseek_credential_status() -> DeepSeekCredentialStatus {
    #[cfg(target_os = "macos")]
    {
        return DeepSeekCredentialStatus {
            configured: stored_api_key().ok().flatten().is_some(),
            supported: true,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        DeepSeekCredentialStatus {
            configured: false,
            supported: false,
        }
    }
}

#[tauri::command]
pub fn set_deepseek_api_key(api_key: String) -> CredentialMutationResult {
    let secret = api_key.trim();
    if secret.is_empty() {
        return credential_failure(CredentialFailure::EmptyKey, "API key cannot be empty");
    }

    #[cfg(target_os = "macos")]
    {
        let entry = match keychain_entry() {
            Ok(entry) => entry,
            Err(()) => {
                return credential_failure(
                    CredentialFailure::Store,
                    "macOS Keychain is unavailable",
                );
            }
        };
        if entry.set_password(secret).is_err() {
            return credential_failure(
                CredentialFailure::Store,
                "macOS Keychain could not save the API key",
            );
        }
        return credential_success();
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = secret;
        credential_failure(
            CredentialFailure::Unsupported,
            "DeepSeek credentials are supported only on macOS",
        )
    }
}

#[tauri::command]
pub fn clear_deepseek_api_key() -> CredentialMutationResult {
    #[cfg(target_os = "macos")]
    {
        let entry = match keychain_entry() {
            Ok(entry) => entry,
            Err(()) => {
                return credential_failure(
                    CredentialFailure::Store,
                    "macOS Keychain is unavailable",
                );
            }
        };
        if entry.delete_credential().is_err() {
            return credential_failure(
                CredentialFailure::Store,
                "macOS Keychain could not clear the API key",
            );
        }
        return credential_success();
    }

    #[cfg(not(target_os = "macos"))]
    {
        credential_failure(
            CredentialFailure::Unsupported,
            "DeepSeek credentials are supported only on macOS",
        )
    }
}

#[tauri::command]
pub async fn generate_prompt_filename_suggestions(body: String) -> FilenameSuggestionResult {
    if body.trim().is_empty() {
        return failure(AiNamingFailure::EmptyPrompt, None);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = body;
        return failure(AiNamingFailure::Unsupported, None);
    }

    #[cfg(target_os = "macos")]
    {
        let api_key = match stored_api_key() {
            Ok(Some(api_key)) => api_key,
            Ok(None) | Err(()) => return failure(AiNamingFailure::NotConfigured, None),
        };
        request_suggestions(&api_key, &body).await
    }
}

async fn request_suggestions(api_key: &str, body: &str) -> FilenameSuggestionResult {
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
        .json(&build_chat_request(body))
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
    let content = match response
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_deref())
    {
        Some(content) => content,
        None => {
            return failure(
                AiNamingFailure::BadResponse,
                Some("missing response content"),
            )
        }
    };

    match parse_filename_suggestions(content) {
        Ok(names) => success(names),
        Err(code) => failure(code, Some("response did not contain three valid names")),
    }
}

fn build_chat_request(body: &str) -> ChatRequest<'_> {
    ChatRequest {
        model: DEEPSEEK_MODEL,
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
        thinking: Thinking { kind: "disabled" },
        stream: false,
        max_tokens: 128,
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
    if value.len() >= 3 && value[value.len() - 3..].eq_ignore_ascii_case(".md") {
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
        let request = serde_json::to_value(build_chat_request("Review this PR.")).unwrap();
        assert_eq!(
            DEEPSEEK_ENDPOINT,
            "https://api.deepseek.com/chat/completions"
        );
        assert_eq!(request["model"], "deepseek-flash");
        assert_eq!(request["thinking"]["type"], "disabled");
        assert_eq!(request["response_format"]["type"], "json_object");
        assert_eq!(request["stream"], false);
        assert_eq!(request["max_tokens"], 128);
        assert_eq!(request["messages"][1]["content"], "Review this PR.");
        assert!(request.get("reasoning_effort").is_none());
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
            map_http_status(StatusCode::INTERNAL_SERVER_ERROR),
            AiNamingFailure::ServiceError
        );
        assert_eq!(map_transport_error(true), AiNamingFailure::Timeout);
        assert_eq!(map_transport_error(false), AiNamingFailure::Network);
    }

    #[test]
    fn credential_and_result_dtos_never_serialize_a_secret() {
        let status = serde_json::to_string(&deepseek_credential_status()).unwrap();
        let result = serde_json::to_string(&CredentialMutationResult {
            status: DeepSeekCredentialStatus {
                configured: true,
                supported: true,
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
