use crate::util::{deps, fsx, net, proc};
use clap::ArgMatches;
use std::path::{Path, PathBuf};

pub fn run_record(m: &ArgMatches) -> i32 {
    // Parse
    let session = m.get_one::<String>("session").unwrap().to_owned();
    let cols = *m.get_one::<u32>("cols").unwrap();
    let rows = *m.get_one::<u32>("rows").unwrap();
    let port_start = *m.get_one::<u16>("port").unwrap();
    let font_size = *m.get_one::<u32>("font_size").unwrap();
    let mut out = m.get_one::<PathBuf>("out").cloned();
    let mut workdir = m.get_one::<PathBuf>("workdir").cloned();
    let kill = *m.get_one::<bool>("kill_on_detach").unwrap_or(&false);
    // deps
    deps::require_cmds(&["ttyd", "tmux", "asciinema"]);
    deps::warn_optionals();

    // defaults
    let home = fsx::home_dir();
    if workdir.is_none() {
        workdir = Some(home.clone());
    }
    if out.is_none() {
        out = Some(home.join("casts").join(format!(
            "{}-{}.cast",
            session,
            fsx::now_yyyymmdd_hhmmss()
        )));
    }

    let out = out.unwrap();
    let workdir = workdir.unwrap();

    // validations
    fsx::validate_workdir(&workdir);
    fsx::ensure_writable_dir(out.parent().unwrap_or_else(|| Path::new(".")));

    let port = net::find_free_port(port_start);

    let exe = std::env::current_exe().expect("failed to get current exe path");
    let mut cmd_and_args = vec![
        exe.to_string_lossy().to_string(),
        "record-hook".to_string(),
        "--child".to_string(),
        "--session".to_string(),
        session.clone(),
        "--cols".to_string(),
        cols.to_string(),
        "--rows".to_string(),
        rows.to_string(),
        "--out".to_string(),
        out.to_string_lossy().to_string(),
        "--workdir".to_string(),
        workdir.to_string_lossy().to_string(),
    ];
    if kill {
        cmd_and_args.push("--kill-on-detach".into());
    }

    let envs = vec![
        ("SESSION", session.clone()),
        ("TMUX_COLS", cols.to_string()),
        ("TMUX_ROWS", rows.to_string()),
        ("ASCII_OUT", out.to_string_lossy().to_string()),
        (
            "TMUX_KILL_ON_DETACH",
            if kill {
                "true".to_string()
            } else {
                "false".to_string()
            },
        ),
    ];

    proc::spawn_ttyd_and_wait(port, font_size, &session, &envs, &cmd_and_args)
}

pub fn run_record_hook(m: &ArgMatches) -> i32 {
    let _child = m.get_flag("child");
    let session = m.get_one::<String>("session").unwrap().to_owned();
    let cols = *m.get_one::<u32>("cols").unwrap();
    let rows = *m.get_one::<u32>("rows").unwrap();
    let mut out = m.get_one::<PathBuf>("out").cloned();
    let mut workdir = m.get_one::<PathBuf>("workdir").cloned();
    let kill = m.get_flag("kill_on_detach");

    let home = fsx::home_dir();
    if workdir.is_none() {
        workdir = Some(home.clone());
    }
    if out.is_none() {
        out = Some(home.join("casts").join(format!(
            "{}-{}.cast",
            session,
            fsx::now_yyyymmdd_hhmmss()
        )));
    }

    let out = out.unwrap();
    let workdir = workdir.unwrap();

    fsx::validate_workdir(&workdir);
    fsx::ensure_writable_dir(out.parent().unwrap_or_else(|| Path::new(".")));

    proc::record_flow(&session, cols, rows, &out, &workdir, kill)
}
