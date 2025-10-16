use std::io;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::util::eprintln_err;
use crate::util::net::wait_for_tcp;

pub fn run_tmux(args: &[&str]) -> io::Result<()> {
    let status = Command::new("tmux").args(args).status()?;
    if !status.success() {
        Err(io::Error::new(
            io::ErrorKind::Other,
            format!("tmux {:?} failed: {}", args, status),
        ))
    } else {
        Ok(())
    }
}

pub fn record_flow(
    session: &str,
    cols: u32,
    rows: u32,
    ascii_out: &Path,
    working_dir: &Path,
    kill_on_detach: bool,
) -> i32 {
    use std::fs;
    if let Some(p) = ascii_out.parent() {
        let _ = fs::create_dir_all(p);
    }

    let sock = format!("ttyd-{session}");
    let has_session = Command::new("tmux")
        .args(["-L", &sock, "has-session", "-t", session])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !has_session {
        let args = [
            "-L",
            &sock,
            "new-session",
            "-c",
            &working_dir.to_string_lossy(),
            "-d",
            "-s",
            session,
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
            "bash",
            "-l",
        ];
        if let Err(e) = run_tmux(&args) {
            eprintln_err(&format!("Failed to create tmux session: {e}"));
            return 2;
        }
        let _ = run_tmux(&["-L", &sock, "set", "-g", "status", "off"]);
    }

    let _ = run_tmux(&["-L", &sock, "set", "-g", "window-size", "manual"]);
    let _ = run_tmux(&["-L", &sock, "set", "-g", "status", "off"]);
    let _ = run_tmux(&[
        "-L",
        &sock,
        "resize-window",
        "-t",
        &format!("{session}:0"),
        "-x",
        &cols.to_string(),
        "-y",
        &rows.to_string(),
    ]);

    eprintln!(
        "[ttyd] Recording to: {} (size {}x{})",
        ascii_out.display(),
        cols,
        rows
    );

    let attach_cmd = format!("tmux -L \"{}\" attach -t \"{}\"", sock, session);
    let mut rec = Command::new("asciinema");
    rec.arg("rec")
        .arg("--overwrite")
        .arg("-q")
        .arg("--cols")
        .arg(cols.to_string())
        .arg("--rows")
        .arg(rows.to_string())
        .arg(ascii_out.to_string_lossy().to_string())
        .arg("-c")
        .arg(&attach_cmd)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let status = rec.spawn().and_then(|mut child| child.wait());
    let rc = match status {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            eprintln_err(&format!("Failed to run asciinema: {e}"));
            1
        }
    };

    if kill_on_detach {
        let _ = run_tmux(&["-L", &sock, "kill-session", "-t", session]);
        let _ = run_tmux(&["-L", &sock, "kill-server"]);
    }

    rc
}

pub fn spawn_ttyd_and_wait(
    port: u16,
    font_size: u32,
    title: &str,
    envs: &[(&str, String)],
    cmd_and_args: &[String],
) -> i32 {
    let mut cmd = Command::new("ttyd");
    cmd.arg("-p")
        .arg(port.to_string())
        .arg("-o")
        .arg("-W")
        .arg("-t")
        .arg(format!("fontSize={font_size}"))
        .arg("-t")
        .arg("disableReconnect=true")
        .arg("-t")
        .arg(format!("titleFixed={title}"))
        .arg("env");
    for (k, v) in envs {
        cmd.arg(format!("{k}={v}"));
    }
    for part in cmd_and_args {
        cmd.arg(part);
    }
    cmd.stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln_err(&format!("Failed to spawn ttyd: {e}"));
            return 1;
        }
    };

    // ctrl-c -> SIGTERM child
    let child_id = child.id();
    ctrlc::set_handler(move || {
        #[cfg(unix)]
        {
            let _ = unsafe { libc::kill(child_id as i32, libc::SIGTERM) };
        }
        #[cfg(not(unix))]
        {
            let _ = child_id;
        }
    })
    .ok();

    let url = format!("http://127.0.0.1:{port}/");
    eprintln!("[ttyd] Waiting for {url} ...");
    wait_for_tcp("127.0.0.1", port, 100, 50);

    // optional browser open
    if which::which("xdg-open").is_ok() {
        let _ = Command::new("xdg-open")
            .arg(&url)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    eprintln!(
        "[ttyd] Serving at {url} (pid {}). Press Ctrl-C to stop.",
        child.id()
    );
    match child.wait() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln_err(&format!("Failed waiting for ttyd: {e}"));
            1
        }
    }
}
