//! Read-only Git history for tracked prompt files.
//!
//! Git is a history source only: no init, commit, push or other writes.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::store;

const DEFAULT_HISTORY_LIMIT: usize = 50;
const FIELD_SEP: char = '\x1f';
const COMMIT_PREFIX: &str = "COMMIT:";
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn git_in_repo(repo_root: &Path) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root).arg("--literal-pathspecs");
    command
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryInfo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileCommit {
    pub hash: String,
    pub short_hash: String,
    pub author_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_email: Option<String>,
    pub authored_at: i64,
    pub subject: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileHistoryPage {
    pub commits: Vec<GitFileCommit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub tracked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub patch: String,
}

struct PromptGitContext {
    repo_root: PathBuf,
    git_path: String,
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

pub fn repository_info(project: &Path) -> Result<GitRepositoryInfo, String> {
    if !git_available() {
        return Ok(GitRepositoryInfo {
            available: false,
            repository_root: None,
            reason: Some("git-unavailable".to_string()),
        });
    }
    let project_root = store::project_root(project)?;
    match find_repository_root(&project_root)? {
        Some(root) => Ok(GitRepositoryInfo {
            available: true,
            repository_root: Some(root.to_string_lossy().into_owned()),
            reason: None,
        }),
        None => Ok(GitRepositoryInfo {
            available: false,
            repository_root: None,
            reason: Some("not-a-repository".to_string()),
        }),
    }
}

pub fn file_history(
    project: &Path,
    name: &str,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<GitFileHistoryPage, String> {
    if !git_available() {
        return Ok(empty_history_page(false));
    }
    let ctx = match prompt_git_context(project, name)? {
        Some(ctx) => ctx,
        None => return Ok(empty_history_page(false)),
    };
    if !is_tracked(&ctx.repo_root, &ctx.git_path)? {
        return Ok(empty_history_page(false));
    }
    let limit = limit.unwrap_or(DEFAULT_HISTORY_LIMIT).clamp(1, 100);
    let skip = cursor
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let fetch_count = skip.saturating_add(limit).saturating_add(1);
    let all_commits = fetch_follow_log(&ctx.repo_root, &ctx.git_path, Some(fetch_count), None)?;
    let has_more = all_commits.len() > skip + limit;
    let commits = all_commits
        .into_iter()
        .skip(skip)
        .take(limit)
        .collect::<Vec<_>>();
    let next_cursor = if has_more {
        Some((skip + limit).to_string())
    } else {
        None
    };
    Ok(GitFileHistoryPage {
        commits,
        next_cursor,
        tracked: true,
    })
}

pub fn file_diff(project: &Path, name: &str, commit: &str) -> Result<GitFileDiff, String> {
    validate_commit_ref(commit)?;
    let ctx = prompt_git_context(project, name)?
        .ok_or_else(|| "project is not in a git repository".to_string())?;
    let full_hash = resolve_commit_hash(&ctx.repo_root, commit)?;
    let (path, previous_path) = lookup_commit_paths(&ctx.repo_root, &ctx.git_path, &full_hash)?;
    let parent = resolve_parent(&ctx.repo_root, &full_hash)?;
    let patch = match parent.as_deref() {
        None => run_git_in_repo(
            &ctx.repo_root,
            &["diff", EMPTY_TREE, &full_hash, "--", path.as_str()],
        )?,
        Some(parent) => {
            let rename_aware = if let Some(previous) = previous_path.as_deref() {
                run_git_in_repo(
                    &ctx.repo_root,
                    &[
                        "diff",
                        "-M",
                        parent,
                        &full_hash,
                        "--",
                        previous,
                        path.as_str(),
                    ],
                )?
            } else {
                run_git_in_repo(
                    &ctx.repo_root,
                    &["diff", "-M", parent, &full_hash, "--", path.as_str()],
                )?
            };
            if rename_aware.trim().is_empty() {
                run_git_in_repo(
                    &ctx.repo_root,
                    &["show", "--format=", &full_hash, "--", path.as_str()],
                )?
            } else {
                rename_aware
            }
        }
    };
    Ok(GitFileDiff {
        commit: full_hash,
        parent,
        patch,
    })
}

fn empty_history_page(tracked: bool) -> GitFileHistoryPage {
    GitFileHistoryPage {
        commits: Vec::new(),
        next_cursor: None,
        tracked,
    }
}

fn prompt_git_context(project: &Path, name: &str) -> Result<Option<PromptGitContext>, String> {
    if !git_available() {
        return Ok(None);
    }
    let repo_root = match repository_root_for_project(project)? {
        Some(root) => root,
        None => return Ok(None),
    };
    let file_path = store::prompt_absolute_path(project, name)?;
    let git_path = path_to_git_relative(&repo_root, &file_path)?;
    Ok(Some(PromptGitContext {
        repo_root,
        git_path,
    }))
}

fn repository_root_for_project(project: &Path) -> Result<Option<PathBuf>, String> {
    if !git_available() {
        return Ok(None);
    }
    let project_root = store::project_root(project)?;
    find_repository_root(&project_root)
}

fn find_repository_root(start: &Path) -> Result<Option<PathBuf>, String> {
    let output = match Command::new("git")
        .arg("-C")
        .arg(start)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
    {
        Ok(output) => output,
        Err(error) => return Err(format!("git command failed: {error}")),
    };
    if !output.status.success() {
        return Ok(None);
    }
    let root = String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();
    if root.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(root)))
}

fn path_to_git_relative(repo_root: &Path, file_path: &Path) -> Result<String, String> {
    let repo_root = repo_root
        .canonicalize()
        .map_err(|error| format!("{}: {error}", repo_root.display()))?;
    let file_path = file_path
        .canonicalize()
        .map_err(|error| format!("{}: {error}", file_path.display()))?;
    match file_path.strip_prefix(&repo_root) {
        Ok(relative) => Ok(relative.to_string_lossy().replace('\\', "/")),
        Err(_) => Err(format!(
            "prompt path is outside the git repository: {}",
            file_path.display()
        )),
    }
}

fn is_tracked(repo_root: &Path, git_path: &str) -> Result<bool, String> {
    let status = git_in_repo(repo_root)
        .arg("ls-files")
        .arg("--error-unmatch")
        .arg("--")
        .arg(git_path)
        .status()
        .map_err(|error| format!("git command failed: {error}"))?;
    Ok(status.success())
}

fn resolve_commit_hash(repo_root: &Path, commit: &str) -> Result<String, String> {
    let output = run_git_in_repo(repo_root, &["rev-parse", "--verify", commit])?;
    let hash = output.trim().to_string();
    if hash.is_empty() {
        return Err(format!("invalid commit hash: {commit}"));
    }
    Ok(hash)
}

fn lookup_commit_paths(
    repo_root: &Path,
    git_path: &str,
    commit: &str,
) -> Result<(String, Option<String>), String> {
    let commits = fetch_follow_log(repo_root, git_path, None, None)?;
    let found = commits
        .into_iter()
        .find(|entry| entry.hash == commit)
        .ok_or_else(|| format!("commit not in prompt history: {commit}"))?;
    Ok((found.path, found.previous_path))
}

fn fetch_follow_log(
    repo_root: &Path,
    git_path: &str,
    limit: Option<usize>,
    commit: Option<&str>,
) -> Result<Vec<GitFileCommit>, String> {
    let format = format!(
        "{COMMIT_PREFIX}%H{sep}%h{sep}%an{sep}%ae{sep}%at{sep}%s",
        sep = FIELD_SEP
    );
    let mut command = git_in_repo(repo_root);
    command
        .arg("log")
        .arg("-z")
        .arg("--follow")
        .arg("--name-status")
        .arg(format!("--format={format}"));
    if let Some(limit) = limit {
        command.arg("-n").arg(limit.to_string());
    }
    if let Some(commit) = commit {
        command.arg(commit);
    }
    command.arg("--").arg(git_path);
    let output = command
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("git command failed".to_string());
        }
        return Err(stderr);
    }
    parse_log_records_from_z(&output.stdout, git_path)
}

fn resolve_parent(repo_root: &Path, commit: &str) -> Result<Option<String>, String> {
    let output = git_in_repo(repo_root)
        .arg("rev-parse")
        .arg(format!("{commit}^"))
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    let parent = String::from_utf8(output.stdout)
        .map_err(|error| error.to_string())?
        .trim()
        .to_string();
    if parent.is_empty() {
        Ok(None)
    } else {
        Ok(Some(parent))
    }
}

fn validate_commit_ref(commit: &str) -> Result<(), String> {
    if commit.trim().is_empty() {
        return Err("commit hash cannot be empty".to_string());
    }
    if commit.starts_with('-') {
        return Err(format!("invalid commit hash: {commit}"));
    }
    if !commit
        .chars()
        .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, '@' | '_' | '.' | '~' | '^'))
    {
        return Err(format!("invalid commit hash: {commit}"));
    }
    Ok(())
}

fn run_git_in_repo(repo_root: &Path, args: &[&str]) -> Result<String, String> {
    let bytes = run_git_in_repo_bytes(repo_root, args)?;
    String::from_utf8(bytes).map_err(|error| format!("git output was not valid UTF-8: {error}"))
}

fn run_git_in_repo_bytes(repo_root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = git_in_repo(repo_root);
    for arg in args {
        command.arg(*arg);
    }
    let output = command
        .output()
        .map_err(|error| format!("git command failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("git command failed".to_string());
        }
        return Err(stderr);
    }
    Ok(output.stdout)
}

#[derive(Debug, Clone)]
struct NameStatusEntry {
    status: String,
    path: String,
    previous_path: Option<String>,
}

fn parse_log_records_from_z(
    output: &[u8],
    head_git_path: &str,
) -> Result<Vec<GitFileCommit>, String> {
    let tokens = split_nul_tokens(output);
    let mut commits = Vec::new();
    let mut index = 0;

    while index < tokens.len() {
        while index < tokens.len() && tokens[index].is_empty() {
            index += 1;
        }
        if index >= tokens.len() {
            break;
        }

        let format_line = token_to_str(tokens[index])?;
        index += 1;
        let commit = parse_commit_fields(&format_line)?;
        let entries = parse_name_status_entries(&tokens, &mut index)?;
        commits.push((commit, entries));

        while index < tokens.len() && tokens[index].is_empty() {
            index += 1;
        }
    }

    resolve_commit_paths_from_entries(commits, head_git_path)
}

fn normalize_name_status(status: String) -> String {
    status.trim_start_matches('\n').to_string()
}

fn parse_name_status_entries(
    tokens: &[&[u8]],
    index: &mut usize,
) -> Result<Vec<NameStatusEntry>, String> {
    let mut entries = Vec::new();
    while *index < tokens.len() && !tokens[*index].is_empty() {
        let raw_status = token_to_str(tokens[*index])?;
        if raw_status.starts_with(COMMIT_PREFIX) {
            break;
        }
        let status = normalize_name_status(raw_status);
        *index += 1;
        if status.starts_with('R') || status.starts_with('C') {
            let previous = token_to_str(tokens[*index])?;
            *index += 1;
            let path = token_to_str(tokens[*index])?;
            *index += 1;
            entries.push(NameStatusEntry {
                status,
                path,
                previous_path: Some(previous),
            });
        } else {
            let path = token_to_str(tokens[*index])?;
            *index += 1;
            entries.push(NameStatusEntry {
                status,
                path,
                previous_path: None,
            });
        }
    }
    Ok(entries)
}

fn resolve_commit_paths_from_entries(
    raw_commits: Vec<(GitFileCommit, Vec<NameStatusEntry>)>,
    head_git_path: &str,
) -> Result<Vec<GitFileCommit>, String> {
    let mut commits = Vec::with_capacity(raw_commits.len());
    let mut current_path = head_git_path.to_string();

    for (mut commit, entries) in raw_commits {
        let selected = select_path_entry(&entries, &current_path).ok_or_else(|| {
            format!(
                "commit {} has no name-status entry for prompt path {}",
                commit.hash, current_path
            )
        })?;
        commit.path = selected.path.clone();
        commit.previous_path = selected.previous_path.clone();
        if let Some(previous) = &selected.previous_path {
            current_path = previous.clone();
        }
        commits.push(commit);
    }

    Ok(commits)
}

fn select_path_entry(entries: &[NameStatusEntry], current_path: &str) -> Option<NameStatusEntry> {
    for entry in entries {
        if entry.path == current_path && entry.previous_path.is_some() {
            return Some(entry.clone());
        }
    }
    for entry in entries {
        if entry.path != current_path {
            continue;
        }
        if entry.status.starts_with('A') {
            if let Some(deleted) = entries.iter().find(|other| other.status.starts_with('D')) {
                return Some(NameStatusEntry {
                    status: entry.status.clone(),
                    path: entry.path.clone(),
                    previous_path: Some(deleted.path.clone()),
                });
            }
        }
        return Some(entry.clone());
    }
    None
}

fn split_nul_tokens(output: &[u8]) -> Vec<&[u8]> {
    output.split(|byte| *byte == 0).collect()
}

fn token_to_str(token: &[u8]) -> Result<String, String> {
    if token.is_empty() {
        return Ok(String::new());
    }
    String::from_utf8(token.to_vec())
        .map_err(|error| format!("git log token was not valid UTF-8: {error}"))
}

fn parse_commit_fields(line: &str) -> Result<GitFileCommit, String> {
    let rest = line
        .strip_prefix(COMMIT_PREFIX)
        .ok_or_else(|| format!("unexpected git log format: {line}"))?;
    let parts: Vec<&str> = rest.split(FIELD_SEP).collect();
    if parts.len() != 6 {
        return Err(format!("unexpected git log format: {line}"));
    }
    let authored_at = parts[4]
        .parse::<i64>()
        .map_err(|error| format!("invalid authoredAt in git log: {error}"))?;
    Ok(GitFileCommit {
        hash: parts[0].to_string(),
        short_hash: parts[1].to_string(),
        author_name: parts[2].to_string(),
        author_email: Some(parts[3].to_string()).filter(|email| !email.is_empty()),
        authored_at,
        subject: parts[5].to_string(),
        path: String::new(),
        previous_path: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_dir(name: &str) -> PathBuf {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("git-test-fixtures");
        fs::create_dir_all(&root).unwrap();
        root.join(format!("{name}-{}", Uuid::new_v4()))
    }

    fn git_ready() -> bool {
        git_available()
    }

    fn run_git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .current_dir(cwd)
            .args(args)
            .status()
            .expect("git command");
        assert!(
            status.success(),
            "git {:?} failed in {}",
            args,
            cwd.display()
        );
    }

    fn init_repo(root: &Path) {
        let template = std::env::temp_dir().join(format!("empty-git-template-{}", Uuid::new_v4()));
        fs::create_dir_all(&template).unwrap();
        let status = Command::new("git")
            .current_dir(root)
            .env("GIT_TEMPLATE_DIR", &template)
            .args(["init"])
            .status()
            .expect("git init");
        assert!(status.success(), "git init failed in {}", root.display());
        run_git(root, &["config", "user.email", "test@example.com"]);
        run_git(root, &["config", "user.name", "Test User"]);
        fs::remove_dir_all(&template).ok();
    }

    fn write_prompt(root: &Path, relative: &str, content: &str) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn commit_all(root: &Path, message: &str) {
        run_git(root, &["add", "-A"]);
        run_git(root, &["commit", "-m", message]);
    }

    #[test]
    fn project_outside_git_repo_reports_not_a_repository() {
        if !git_ready() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("promptarium-git-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let info = repository_info(&dir).unwrap();
        assert_eq!(
            info,
            GitRepositoryInfo {
                available: false,
                repository_root: None,
                reason: Some("not-a-repository".to_string()),
            }
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_at_repo_root_returns_history() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("root");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "review.md", "Review this PR.");
        commit_all(&dir, "Initial review prompt");
        write_prompt(&dir, "review.md", "Review this PR for regressions.");
        commit_all(&dir, "Refine review criteria");

        let page = file_history(&dir, "review", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].subject, "Refine review criteria");
        assert_eq!(page.commits[0].path, "review.md");

        let diff = file_diff(&dir, "review", &page.commits[0].hash).unwrap();
        assert!(diff.patch.contains('-'));
        assert!(diff.patch.contains('+'));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unicode_prompt_filename_history_and_diff_work() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("unicode");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "中文提示.md", "第一版内容。");
        commit_all(&dir, "Add unicode prompt");
        write_prompt(&dir, "中文提示.md", "第二版内容。");
        commit_all(&dir, "Edit unicode prompt");

        let page = file_history(&dir, "中文提示", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].path, "中文提示.md");

        let diff = file_diff(&dir, "中文提示", &page.commits[0].hash).unwrap();
        assert!(diff.patch.contains('+'));
        assert!(diff.patch.contains("第二版内容。"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_in_repo_subdirectory_resolves_paths() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("subdir");
        let prompts = dir.join("prompts");
        fs::create_dir_all(&prompts).unwrap();
        init_repo(&dir);
        write_prompt(&prompts, "coding/review-pr.md", "Review this PR.");
        commit_all(&dir, "Add review prompt");

        let page = file_history(&prompts, "coding/review-pr", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].path, "prompts/coding/review-pr.md");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn untracked_prompt_returns_not_tracked_without_error() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("untracked");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "draft.md", "Not committed yet.");
        let page = file_history(&dir, "draft", None, None).unwrap();
        assert!(!page.tracked);
        assert!(page.commits.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn root_commit_diff_is_available() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("root-commit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "first.md", "First version.");
        commit_all(&dir, "Root commit");
        let page = file_history(&dir, "first", None, None).unwrap();
        let first = &page.commits[0];
        let diff = file_diff(&dir, "first", &first.hash).unwrap();
        assert!(diff.parent.is_none());
        assert!(diff.patch.contains('+'));
        assert!(diff.patch.contains("First version."));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_follows_history_and_diffs_use_historical_paths() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("rename");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "old-name.md", "Version one.");
        commit_all(&dir, "Add prompt");
        fs::rename(dir.join("old-name.md"), dir.join("new-name.md")).unwrap();
        commit_all(&dir, "Rename prompt");
        write_prompt(&dir, "new-name.md", "Version two.");
        commit_all(&dir, "Edit after rename");

        let page = file_history(&dir, "new-name", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 3);
        assert_eq!(page.commits[2].path, "old-name.md");

        let first_diff = file_diff(&dir, "new-name", &page.commits[2].hash).unwrap();
        assert!(
            first_diff.patch.contains("Version one."),
            "first commit diff should show the original content"
        );
        assert!(!first_diff.patch.trim().is_empty());

        let rename_diff = file_diff(&dir, "new-name", &page.commits[1].hash).unwrap();
        assert!(
            rename_diff.patch.contains("old-name.md") || rename_diff.patch.contains("rename"),
            "rename commit diff should reflect the rename, got: {}",
            rename_diff.patch
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_and_edit_in_same_commit_preserves_rename_diff() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("rename-edit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        let mut body = String::new();
        for line in 1..=20 {
            body.push_str(&format!("line {line}\n"));
        }
        write_prompt(&dir, "old.md", &body);
        commit_all(&dir, "Add prompt");
        fs::rename(dir.join("old.md"), dir.join("new.md")).unwrap();
        let edited = body.replace("line 10\n", "line TEN edited\n");
        write_prompt(&dir, "new.md", &edited);
        commit_all(&dir, "Rename and edit");

        let page = file_history(&dir, "new", None, None).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[0].previous_path.as_deref(), Some("old.md"));
        assert_eq!(page.commits[0].path, "new.md");

        let diff = file_diff(&dir, "new", &page.commits[0].hash).unwrap();
        assert!(
            diff.patch.contains("rename from old.md") || diff.patch.contains("rename to new.md"),
            "rename+edit diff should preserve rename semantics, got: {}",
            diff.patch
        );
        assert!(
            diff.patch.contains("line TEN edited") || diff.patch.contains('+'),
            "rename+edit diff should include the edited line"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_outside_prompt_history_is_rejected() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("foreign-commit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "private.md", "secret");
        commit_all(&dir, "Add private");
        let private_page = file_history(&dir, "private", None, None).unwrap();
        let foreign_hash = private_page.commits[0].hash.clone();

        write_prompt(&dir, "prompts/review.md", "Review");
        commit_all(&dir, "Add review");
        let prompts = dir.join("prompts");
        let error = file_diff(&prompts, "review", &foreign_hash).unwrap_err();
        assert!(
            error.contains("commit not in prompt history"),
            "unexpected error: {error}"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn pagination_fetches_skip_in_one_follow_log() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("pagination");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "review.md", "v1");
        commit_all(&dir, "v1");
        write_prompt(&dir, "review.md", "v2");
        commit_all(&dir, "v2");
        write_prompt(&dir, "review.md", "v3");
        commit_all(&dir, "v3");

        let first = file_history(&dir, "review", Some(2), None).unwrap();
        assert_eq!(first.commits.len(), 2);
        assert_eq!(first.commits[0].subject, "v3");
        assert!(first.next_cursor.is_some());

        let second = file_history(&dir, "review", Some(2), first.next_cursor.as_deref()).unwrap();
        assert_eq!(second.commits.len(), 1);
        assert_eq!(second.commits[0].subject, "v1");
        assert!(second.next_cursor.is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filename_with_spaces_is_supported() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("spaces");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "my prompt.md", "Spaced filename.");
        commit_all(&dir, "Add spaced prompt");
        let page = file_history(&dir, "my prompt", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        assert_eq!(page.commits[0].path, "my prompt.md");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn malicious_prompt_name_does_not_inject_git_options() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("option-inject");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "--help.md", "Safe content.");
        commit_all(&dir, "Add oddly named prompt");
        let page = file_history(&dir, "--help", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_commit_hash_is_rejected() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("bad-commit");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "review.md", "Body");
        commit_all(&dir, "Initial");
        let error = file_diff(&dir, "review", "--help").unwrap_err();
        assert!(error.contains("invalid commit hash"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn literal_pathspec_metacharacters_do_not_match_siblings() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("pathspec-glob");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "foo*.md", "star prompt");
        write_prompt(&dir, "foo-secret.md", "secret sibling");
        commit_all(&dir, "Add both prompts");
        write_prompt(&dir, "foo-secret.md", "secret sibling v2");
        commit_all(&dir, "Edit sibling only");
        write_prompt(&dir, "foo*.md", "star prompt v2");
        commit_all(&dir, "Edit star prompt");

        let page = file_history(&dir, "foo*", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(
            page.commits.len(),
            2,
            "history should ignore commits that only touched foo-secret.md"
        );
        assert_eq!(page.commits[0].subject, "Edit star prompt");
        assert_eq!(page.commits[1].subject, "Add both prompts");

        let diff = file_diff(&dir, "foo*", &page.commits[0].hash).unwrap();
        assert!(
            diff.patch.contains("star prompt v2"),
            "diff should include the star prompt edit"
        );
        assert!(
            !diff.patch.contains("foo-secret"),
            "diff must not leak the sibling file, got: {}",
            diff.patch
        );
        assert!(
            !diff.patch.contains("secret sibling"),
            "diff must not include sibling content, got: {}",
            diff.patch
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn literal_pathspec_does_not_confuse_tracked_sibling_for_untracked_prompt() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("pathspec-tracked");
        fs::create_dir_all(&dir).unwrap();
        init_repo(&dir);
        write_prompt(&dir, "foo-secret.md", "secret sibling");
        commit_all(&dir, "Track sibling only");
        write_prompt(&dir, "foo*.md", "untracked star prompt");

        let page = file_history(&dir, "foo*", None, None).unwrap();
        assert!(
            !page.tracked,
            "untracked foo*.md must not appear tracked because foo-secret.md matches as a glob"
        );
        assert!(page.commits.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn historical_pathspec_magic_is_treated_literally() {
        if !git_ready() {
            return;
        }
        let dir = tmp_dir("pathspec-magic");
        let prompts = dir.join("prompts");
        fs::create_dir_all(&prompts).unwrap();
        init_repo(&dir);
        fs::write(dir.join("secret.txt"), "top secret").unwrap();
        write_prompt(&dir, ":(top)**.md", "magic prompt");
        commit_all(&dir, "Add magic prompt and secret");
        fs::rename(dir.join(":(top)**.md"), prompts.join("new.md")).unwrap();
        commit_all(&dir, "Move prompt into project");

        let page = file_history(&prompts, "new", None, None).unwrap();
        assert!(page.tracked);
        assert_eq!(page.commits.len(), 2);
        assert_eq!(page.commits[1].path, ":(top)**.md");

        let diff = file_diff(&prompts, "new", &page.commits[1].hash).unwrap();
        assert!(
            diff.patch.contains("magic prompt"),
            "root commit diff should include the original prompt"
        );
        assert!(
            !diff.patch.contains("secret.txt"),
            "root commit diff must not include unrelated repo files, got: {}",
            diff.patch
        );
        assert!(
            !diff.patch.contains("top secret"),
            "root commit diff must not leak secret.txt content, got: {}",
            diff.patch
        );
        fs::remove_dir_all(&dir).ok();
    }
}
