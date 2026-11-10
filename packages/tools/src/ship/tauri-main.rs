// Mirage original code. Tauri 2 main written by `mirage-ship --target desktop-tauri` (template).
// The game is the web build in ../www, shown in the system WebView (WebView2 on Windows, WKWebView on macOS,
// WebKitGTK on Linux). This file adds what the page cannot do itself: saves as files in the app-data folder,
// fullscreen of the real window, quit. Window size and place are kept by tauri-plugin-window-state.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

const MAX_KEY: usize = 200;
const MAX_VALUE: usize = 32 * 1024 * 1024;

// <app data>/saves: %APPDATA%\<identifier> on Windows, ~/Library/Application Support/<identifier> on macOS,
// ~/.local/share/<identifier> on Linux
fn saves_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("saves");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// one file per key; every byte outside [A-Za-z0-9_-] is %XX, so no key can hold a path separator or name ".."
fn encode_key(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > MAX_KEY {
        return Err("bad save key".into());
    }
    let mut name = String::with_capacity(key.len() + 8);
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            name.push(b as char);
        } else {
            name.push_str(&format!("%{:02X}", b));
        }
    }
    Ok(name)
}

fn decode_key(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = name.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn save_file(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(saves_dir(app)?.join(format!("{}.json", encode_key(key)?)))
}

#[tauri::command]
fn save_keys(app: AppHandle) -> Result<Vec<String>, String> {
    let mut keys = Vec::new();
    for entry in fs::read_dir(saves_dir(&app)?).map_err(|e| e.to_string())? {
        let name = entry.map_err(|e| e.to_string())?.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name.strip_suffix(".json") {
            if let Some(key) = decode_key(stem) {
                keys.push(key);
            }
        }
    }
    keys.sort();
    Ok(keys)
}

#[tauri::command]
fn save_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    match fs::read_to_string(save_file(&app, &key)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// written to a temporary file and renamed: a crash in the middle of a write leaves the previous save
#[tauri::command]
fn save_set(app: AppHandle, key: String, value: String) -> Result<bool, String> {
    if value.len() > MAX_VALUE {
        return Err("bad save value".into());
    }
    let file = save_file(&app, &key)?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, value).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn save_remove(app: AppHandle, key: String) -> Result<bool, String> {
    match fs::remove_file(save_file(&app, &key)?) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn set_fullscreen(window: WebviewWindow, on: bool) -> Result<bool, String> {
    window.set_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
fn is_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            save_keys,
            save_get,
            save_set,
            save_remove,
            set_fullscreen,
            is_fullscreen,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
