use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::Manager;

fn wait_port(port: u16) -> bool {
    for _ in 0..80 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

fn server_entry(resource_dir: PathBuf) -> PathBuf {
    for candidate in [
        resource_dir.join("server").join("index.js"),
        resource_dir.join("dist").join("index.js"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../server/dist/index.js"),
    ] {
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../server/dist/index.js")
}

fn spawn_local_api(resource_dir: PathBuf) {
    if TcpStream::connect(("127.0.0.1", 18787)).is_ok() {
        return;
    }
    let entry = server_entry(resource_dir);
    let mut cmd = Command::new("node");
    cmd.arg(&entry)
        .env("VISUALFORGE_HOST", "127.0.0.1")
        .env("VISUALFORGE_PORT", "18787")
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    let _ = cmd.spawn();
    let _ = wait_port(18787);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let dir = app.path().resource_dir().unwrap_or_else(|_| std::env::current_dir().unwrap());
                spawn_local_api(dir);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running VisualForge");
}
