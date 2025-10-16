use crate::util::eprintln_err;
use chrono::Local;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

pub fn now_yyyymmdd_hhmmss() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            eprintln_err("Could not determine $HOME");
            std::process::exit(1);
        })
}

pub fn ensure_writable_dir(p: &Path) {
    if let Err(e) = fs::create_dir_all(p) {
        eprintln_err(&format!(
            "Directory does not exist and could not be created: {} ({})",
            p.display(),
            e
        ));
        std::process::exit(1);
    }
    let probe = p.join(".writable_probe.tmp");
    match File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
        }
        Err(_) => {
            eprintln_err(&format!("Directory is not writable: {}", p.display()));
            std::process::exit(1);
        }
    }
}

pub fn validate_workdir(p: &Path) {
    if !p.is_dir() {
        eprintln_err(&format!(
            "WORKING_DIRECTORY does not exist: {}",
            p.display()
        ));
        std::process::exit(1);
    }
    if std::fs::read_dir(p).is_err() {
        eprintln_err(&format!(
            "WORKING_DIRECTORY is not readable: {}",
            p.display()
        ));
        std::process::exit(1);
    }
}
