//! Promptarium — the native shell.
//!
//! Rust owns the filesystem (the Markdown prompt store and the app-local
//! roster). The SvelteKit frontend owns rendering and the variable grammar.

mod datadir;
mod prompts;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Self-update. The frontend drives the whole lifecycle (check, download,
        // install) through `src/lib/updater.svelte.ts`; there is no v2 `dialog`
        // option to hand it off to, and no Rust command surface of our own.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            app.manage(prompts::state::PromptsState::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prompts::state::list_projects,
            prompts::state::add_project,
            prompts::state::rename_project_label,
            prompts::state::replace_project_path,
            prompts::state::set_project_color,
            prompts::state::remove_project,
            prompts::state::set_active_project,
            prompts::state::sync_project_watcher,
            prompts::state::scan_project,
            prompts::state::scan_folders,
            prompts::state::read_prompt,
            prompts::state::create_prompt,
            prompts::state::save_prompt,
            prompts::state::rename_prompt,
            prompts::state::move_prompt,
            prompts::state::delete_prompt,
            prompts::state::create_folder,
            prompts::state::rename_folder,
            prompts::state::delete_empty_folder,
            prompts::state::search_prompts,
            prompts::state::reveal_in_finder,
            prompts::state::resolve_prompt_assets,
            prompts::state::reveal_asset_in_finder,
            prompts::state::asset_reference_from_selected_path,
            prompts::state::git_repository_info,
            prompts::state::git_file_history,
            prompts::state::git_file_diff,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
