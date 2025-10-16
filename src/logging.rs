use clap::ArgMatches;
use std::str::FromStr;

pub fn init_from_matches(matches: &ArgMatches) {
    let level = if matches.get_flag("verbose") {
        Some("debug".to_string())
    } else {
        matches.get_one::<String>("log").cloned()
    }
    .or_else(|| std::env::var("RUST_LOG").ok())
    .unwrap_or_else(|| "info".to_string());

    env_logger::Builder::new()
        .filter_level(log::LevelFilter::from_str(&level).unwrap_or(log::LevelFilter::Info))
        .format_timestamp(None)
        .init();
    log::debug!("logging initialized at {level}");
}
