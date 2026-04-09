use serde_json::{json, Map, Value};
use std::env;
use std::io::{self, IsTerminal, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use terminal_size::{terminal_size_of, Width};

use crate::contract::manifest;
use crate::error::{CliError, ErrorPresentation};

const MAX_RENDER_WIDTH: usize = 120;
const MIN_RENDER_WIDTH: usize = 40;
const SPINNER_INTERVAL_MS: u64 = 80;
const ASCII_SPINNER_FRAMES: [&str; 4] = ["-", "\\", "|", "/"];
const UNICODE_SPINNER_FRAMES: [&str; 10] =
    ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SectionTone {
    Accent,
    Muted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutputWidthClass {
    Wide,
    Compact,
    Narrow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CalloutKind {
    Success,
    Warning,
    Danger,
    Recovery,
    Privacy,
    ReadOnly,
}

pub struct Spinner {
    running: Option<Arc<AtomicBool>>,
    handle: Option<JoinHandle<()>>,
    line_width: usize,
}

impl Spinner {
    pub fn stop(&mut self) {
        let Some(running) = self.running.take() else {
            return;
        };

        running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }

        if self.line_width > 0 {
            let clear = format!("\r{}\r", " ".repeat(self.line_width + 2));
            let mut stderr = io::stderr();
            let _ = stderr.write_all(clear.as_bytes());
            let _ = stderr.flush();
        }
    }
}

impl Drop for Spinner {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn emit_help(text: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "help",
            "help": text.trim_end()
        }));
    } else {
        write_stdout_human_text(text);
    }
}

pub fn emit_version(version: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "version",
            "version": version
        }));
    } else {
        let _ = io::stdout().write_all(format!("{version}\n").as_bytes());
    }
}

pub fn write_stdout_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    let _ = io::stdout().write_all(value.as_bytes());
}

pub fn write_stdout_human_text(text: &str) {
    write_stdout_text(&maybe_strip_ansi(text, stdout_supports_style()));
}

pub fn write_stderr_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    let _ = io::stderr().write_all(value.as_bytes());
}

pub fn write_stderr_block_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with("\n\n") {
        value.push('\n');
        value.push('\n');
    }
    let _ = io::stderr().write_all(value.as_bytes());
}

pub fn write_stderr_human_text(text: &str) {
    write_stderr_text(&maybe_strip_ansi(text, stderr_supports_style()));
}

pub fn write_stderr_human_block_text(text: &str) {
    write_stderr_block_text(&maybe_strip_ansi(text, stderr_supports_style()));
}

pub fn start_spinner(message: &str) -> Spinner {
    if !stderr_supports_animation() {
        write_stderr_text(&format!("- {message}"));
        return Spinner {
            running: None,
            handle: None,
            line_width: 0,
        };
    }

    let running = Arc::new(AtomicBool::new(true));
    let worker_running = Arc::clone(&running);
    let message = message.to_string();
    let line_width = message.chars().count() + 2;
    let frames = if stderr_supports_unicode_animation() {
        UNICODE_SPINNER_FRAMES.as_slice()
    } else {
        ASCII_SPINNER_FRAMES.as_slice()
    };
    let handle = thread::spawn(move || {
        let mut frame_index = 0usize;
        while worker_running.load(Ordering::SeqCst) {
            let frame = styled_accent(frames[frame_index % frames.len()]);
            let line = format!("\r{frame} {message}");
            let mut stderr = io::stderr();
            let _ = stderr.write_all(line.as_bytes());
            let _ = stderr.flush();
            frame_index += 1;
            thread::sleep(Duration::from_millis(SPINNER_INTERVAL_MS));
        }
    });

    Spinner {
        running: Some(running),
        handle: Some(handle),
        line_width,
    }
}

pub fn format_section_heading(title: &str) -> String {
    format_section_heading_with_tone(title, SectionTone::Accent)
}

pub fn format_command_heading(title: &str) -> String {
    format!("\n{}\n\n", styled_accent_bold(title))
}

pub fn format_muted_section_heading(title: &str) -> String {
    format_section_heading_with_tone(title, SectionTone::Muted)
}

pub fn format_muted_block(text: &str) -> String {
    styled_dim(text)
}

pub fn format_muted_text(text: &str) -> String {
    styled_dim(text)
}

pub fn format_notice_text(text: &str) -> String {
    styled_notice(text)
}

pub fn format_success_text(text: &str) -> String {
    styled_success(text)
}

pub fn format_danger_text(text: &str) -> String {
    styled_danger(text)
}

pub fn format_key_value_rows(rows: &[(&str, String)]) -> String {
    if rows.is_empty() {
        return String::new();
    }

    let width = rows
        .iter()
        .map(|(label, _)| label.len() + 1)
        .max()
        .unwrap_or(0);

    let mut output = String::new();
    for (label, value) in rows {
        let padded_label = format!("{label}:");
        output.push_str("  ");
        output.push_str(&styled_dim(&format!(
            "{padded_label:<width$}",
            width = width
        )));
        output.push(' ');
        output.push_str(value);
        output.push('\n');
    }
    output
}

pub fn format_callout(kind: CalloutKind, lines: &[String]) -> String {
    if lines.is_empty() {
        return String::new();
    }

    let gutter = if supports_unicode_output() { "│" } else { "|" };
    let heading = match kind {
        CalloutKind::Success => styled_bold(&format!("{}:", styled_success("Success"))),
        CalloutKind::Warning => styled_bold(&format!("{}:", styled_notice("Warning"))),
        CalloutKind::Danger => styled_bold(&format!("{}:", styled_danger("Danger"))),
        CalloutKind::Recovery => styled_bold(&format!("{}:", styled_accent("Recovery"))),
        CalloutKind::Privacy => styled_bold(&format!("{}:", styled_notice("Privacy note"))),
        CalloutKind::ReadOnly => styled_bold(&format!("{}:", styled_accent("Read-only note"))),
    };

    let wrap_width = current_render_width().saturating_sub(6).max(24);
    let mut output = String::new();
    output.push('\n');
    output.push_str("  ");
    output.push_str(gutter);
    output.push(' ');
    output.push_str(&heading);
    output.push('\n');
    for line in lines {
        for wrapped in wrap_text(line, wrap_width) {
            output.push_str("  ");
            output.push_str(gutter);
            output.push(' ');
            output.push_str(&wrapped);
            output.push('\n');
        }
    }
    output
}

fn format_section_heading_with_tone(title: &str, tone: SectionTone) -> String {
    let divider = styled_dim(&section_divider_line());
    let heading = match tone {
        SectionTone::Accent => styled_accent_bold(&format!("{title}:")),
        SectionTone::Muted => styled_dim(&format!("{title}:")),
    };
    format!("\n{divider}\n{heading}\n")
}

fn json_schema_version() -> &'static str {
    manifest().json_schema_version.as_str()
}

pub fn print_json_success(payload: Value) {
    let source = payload.as_object().cloned().unwrap_or_default();
    let mut object = Map::new();
    object.insert(
        "schemaVersion".to_string(),
        Value::String(json_schema_version().to_string()),
    );
    object.insert("success".to_string(), Value::Bool(true));
    for (key, value) in source {
        object.insert(key, value);
    }
    write_stdout_text(
        &serde_json::to_string(&Value::Object(object)).expect("json success must serialize"),
    );
}

pub fn print_error_and_exit(error: &CliError, structured: bool, quiet: bool) -> ! {
    if structured {
        let payload = json!({
            "schemaVersion": json_schema_version(),
            "success": false,
            "errorCode": error.code,
            "errorMessage": error.message,
            "error": {
                "category": error.category.as_str(),
                "message": error.message,
                "hint": error.hint,
                "retryable": error.retryable,
                "code": error.code,
            }
        });
        write_stdout_text(&serde_json::to_string(&payload).expect("json error must serialize"));
    } else if !quiet {
        match error.presentation {
            ErrorPresentation::Inline => {
                write_stderr_text(&format!(
                    "{}",
                    styled_danger(&format!("Error [{}]: {}", error.category.as_str(), error.message))
                ));
                if let Some(hint) = &error.hint {
                    write_stderr_text(&styled_notice(&format!("Hint: {hint}")));
                }
            }
            ErrorPresentation::Boxed => write_stderr_text(&format_boxed_error(error)),
        }
    }

    std::process::exit(error.category.exit_code());
}

pub fn format_count_number(value: u64) -> String {
    let digits = value.to_string();
    let mut output = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, character) in digits.chars().rev().enumerate() {
        if index > 0 && index % 3 == 0 {
            output.push(',');
        }
        output.push(character);
    }
    output.chars().rev().collect()
}

pub fn format_address(value: &str, chars: usize) -> String {
    if value.chars().count() <= chars * 2 + 2 {
        return value.to_string();
    }
    let prefix = value.chars().take(chars + 2).collect::<String>();
    let suffix = value
        .chars()
        .rev()
        .take(chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("{prefix}...{suffix}")
}

pub fn format_time_ago(timestamp_ms: Option<u64>) -> String {
    let Some(timestamp_ms) = timestamp_ms else {
        return "-".to_string();
    };
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_millis() as u64;
    let delta_ms = now_ms.saturating_sub(timestamp_ms);
    let seconds = delta_ms / 1000;
    if seconds < 60 {
        return format!("{seconds}s ago");
    }
    let minutes = seconds / 60;
    if minutes < 60 {
        return format!("{minutes}m ago");
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours}h ago");
    }
    let days = hours / 24;
    format!("{days}d ago")
}

pub fn print_csv(headers: Vec<&str>, rows: Vec<Vec<String>>) {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        headers
            .into_iter()
            .map(escape_csv_field)
            .collect::<Vec<_>>()
            .join(","),
    );
    for row in rows {
        lines.push(
            row.iter()
                .map(|cell| escape_csv_field(cell))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    write_stdout_text(&lines.join("\n"));
}

pub fn print_table(headers: Vec<&str>, rows: Vec<Vec<String>>) {
    let headers = headers
        .into_iter()
        .map(|header| header.to_string())
        .collect::<Vec<_>>();
    let mut widths = headers
        .iter()
        .map(|header| visible_width(header))
        .collect::<Vec<_>>();
    for row in &rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(visible_width(cell));
        }
    }

    let terminal_columns = current_terminal_columns();
    let width_class = output_width_class(terminal_columns);
    if !rows.is_empty()
        && (matches!(width_class, OutputWidthClass::Narrow)
            || estimated_table_width(&widths) > terminal_columns)
    {
        print_stacked_table(&headers, &rows);
        return;
    }

    let gap = "   ";
    let fill = if supports_unicode_output() { '─' } else { '-' };
    let header_row = format!(
        "  {}",
        headers
            .iter()
            .enumerate()
            .map(|(index, header)| styled_bold(&pad_display(header, widths[index])))
            .collect::<Vec<_>>()
            .join(gap)
    );
    let underline_row = format!(
        "  {}",
        widths
            .iter()
            .map(|width| styled_dim(&fill.to_string().repeat(*width)))
            .collect::<Vec<_>>()
            .join(gap)
    );
    let body_rows = rows
        .iter()
        .map(|row| {
            format!(
                "  {}",
                row.iter()
                    .enumerate()
                    .map(|(index, cell)| pad_display(cell, widths[index]))
                    .collect::<Vec<_>>()
                    .join(gap)
            )
        })
        .collect::<Vec<_>>();

    let mut output = String::new();
    output.push_str(&header_row);
    output.push('\n');
    output.push_str(&underline_row);
    if !body_rows.is_empty() {
        output.push('\n');
        output.push_str(&body_rows.join("\n"));
    }
    write_stderr_text(&output);
}

fn print_stacked_table(headers: &[String], rows: &[Vec<String>]) {
    let mut output = String::new();
    let label_width = headers.iter().map(|header| header.len() + 1).max().unwrap_or(0);

    for (row_index, row) in rows.iter().enumerate() {
        if row_index > 0 {
            output.push('\n');
        }
        for (index, header) in headers.iter().enumerate() {
            let value = row.get(index).cloned().unwrap_or_else(|| "-".to_string());
            let label = format!("{header}:");
            output.push_str("  ");
            output.push_str(&styled_dim(&format!(
                "{label:<label_width$}",
                label_width = label_width
            )));
            output.push(' ');
            output.push_str(&value);
            output.push('\n');
        }
    }

    write_stderr_text(output.trim_end());
}

pub fn write_info(message: &str) {
    write_stderr_text(&format!("{} {message}", styled_accent(info_glyph())));
}

pub fn insert_optional_string(object: &mut Map<String, Value>, key: &str, value: Option<String>) {
    object.insert(
        key.to_string(),
        value.map(Value::String).unwrap_or(Value::Null),
    );
}

pub fn insert_optional_u64(object: &mut Map<String, Value>, key: &str, value: Option<u64>) {
    object.insert(
        key.to_string(),
        value
            .map(|value| Value::Number(value.into()))
            .unwrap_or(Value::Null),
    );
}

pub fn insert_optional_f64(object: &mut Map<String, Value>, key: &str, value: Option<f64>) {
    object.insert(
        key.to_string(),
        value
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null),
    );
}

pub fn render_next_steps(actions: &[Value]) {
    let runnable = actions
        .iter()
        .filter(|action| action.get("runnable").and_then(Value::as_bool) != Some(false))
        .filter_map(|action| {
            let reason = action.get("reason").and_then(Value::as_str)?;
            let command = build_human_next_action_command(action)?;
            Some((command, reason.to_string()))
        })
        .collect::<Vec<_>>();

    if runnable.is_empty() {
        return;
    }

    write_stderr_text(&format_muted_section_heading("Next steps"));
    for (command, reason) in runnable.into_iter() {
        write_stderr_text(&format!(
            "  {} {}",
            styled_dim(next_glyph()),
            styled_accent(&command)
        ));
        write_stderr_text(&format!("     {}", styled_dim(&reason)));
    }
}

fn build_human_next_action_command(action: &Value) -> Option<String> {
    let object = action.as_object()?;
    let command = object.get("command")?.as_str()?;
    let args = object
        .get("args")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect::<Vec<_>>());
    let options = object.get("options").and_then(Value::as_object);
    let args_ref = args.as_deref();
    Some(build_cli_command(command, args_ref, options, false))
}

// ── NextAction helpers ─────────────────────────────────────────────────────

fn camel_to_kebab(key: &str) -> String {
    let mut result = String::with_capacity(key.len() + 4);
    for ch in key.chars() {
        if ch.is_uppercase() {
            if !result.is_empty() {
                result.push('-');
            }
            result.push(ch.to_lowercase().next().unwrap_or(ch));
        } else {
            result.push(ch);
        }
    }
    result
}

fn build_cli_command(
    command: &str,
    args: Option<&[&str]>,
    options: Option<&Map<String, Value>>,
    include_agent: bool,
) -> String {
    let mut parts = vec!["privacy-pools".to_string(), command.to_string()];

    if let Some(args) = args {
        for arg in args {
            parts.push(arg.to_string());
        }
    }

    if let Some(opts) = options {
        for (key, value) in opts {
            if key == "agent" {
                if include_agent && value.as_bool() == Some(true) {
                    parts.push("--agent".to_string());
                }
                continue;
            }
            match value {
                Value::Null => {}
                Value::Bool(true) => parts.push(format!("--{}", camel_to_kebab(key))),
                Value::Bool(false) => parts.push(format!("--no-{}", camel_to_kebab(key))),
                Value::Number(n) => {
                    parts.push(format!("--{}", camel_to_kebab(key)));
                    parts.push(n.to_string());
                }
                Value::String(s) => {
                    parts.push(format!("--{}", camel_to_kebab(key)));
                    parts.push(s.clone());
                }
                _ => {}
            }
        }
    }

    parts.join(" ")
}

pub fn build_next_action(
    command: &str,
    reason: &str,
    when: &str,
    args: Option<&[&str]>,
    options: Option<&Map<String, Value>>,
    runnable: Option<bool>,
) -> Value {
    let cli_command = build_cli_command(command, args, options, true);
    let mut action = Map::new();
    action.insert("command".to_string(), Value::String(command.to_string()));
    action.insert("reason".to_string(), Value::String(reason.to_string()));
    action.insert("when".to_string(), Value::String(when.to_string()));

    if let Some(args) = args {
        if !args.is_empty() {
            action.insert(
                "args".to_string(),
                Value::Array(args.iter().map(|a| Value::String(a.to_string())).collect()),
            );
        }
    }

    if let Some(opts) = options {
        if !opts.is_empty() {
            let filtered: Map<String, Value> = opts
                .iter()
                .filter(|(_, value)| !value.is_null())
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            if !filtered.is_empty() {
                action.insert("options".to_string(), Value::Object(filtered));
            }
        }
    }

    if runnable == Some(false) {
        action.insert("runnable".to_string(), Value::Bool(false));
    }

    action.insert("cliCommand".to_string(), Value::String(cli_command));
    Value::Object(action)
}

fn escape_csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn table_border(left: char, middle: char, right: char, widths: &[usize]) -> String {
    let segments = widths
        .iter()
        .map(|width| table_horizontal_segment(*width + 2))
        .collect::<Vec<_>>();
    format!("{left}{}{right}", segments.join(&middle.to_string()))
}

fn style_table_border(value: &str) -> String {
    styled_dim(value)
}

fn table_row(row: &[String], widths: &[usize]) -> String {
    table_row_with_style(row, widths, None)
}

fn table_row_with_style(
    row: &[String],
    widths: &[usize],
    style: Option<fn(&str) -> String>,
) -> String {
    let vertical = table_chars().vertical;
    let cells = row
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            let padding = widths[index].saturating_sub(visible_width(cell));
            let rendered = style
                .map(|apply| apply(cell))
                .unwrap_or_else(|| cell.clone());
            format!(" {rendered}{} ", " ".repeat(padding))
        })
        .collect::<Vec<_>>();
    format!("{vertical}{}{vertical}", cells.join(&vertical.to_string()))
}

fn visible_width(value: &str) -> usize {
    strip_ansi_codes(value).chars().count()
}

fn estimated_table_width(widths: &[usize]) -> usize {
    widths.iter().sum::<usize>() + widths.len() * 3 + 1
}

fn strip_ansi_codes(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            let _ = chars.next();
            for control in chars.by_ref() {
                if ('@'..='~').contains(&control) {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }

    output
}

fn maybe_strip_ansi(value: &str, should_preserve: bool) -> String {
    if should_preserve {
        value.to_string()
    } else {
        strip_ansi_codes(value)
    }
}

fn stdout_supports_style() -> bool {
    stream_supports_style(io::stdout().is_terminal())
}

fn stderr_supports_style() -> bool {
    stream_supports_style(io::stderr().is_terminal())
}

fn stream_supports_style(is_terminal: bool) -> bool {
    if env::var_os("NO_COLOR").is_some() {
        return false;
    }

    match env::var("FORCE_COLOR") {
        Ok(value) => value != "0",
        Err(_) => is_terminal,
    }
}

fn stderr_supports_animation() -> bool {
    io::stderr().is_terminal()
}

fn current_terminal_columns() -> usize {
    parse_terminal_columns_override("PRIVACY_POOLS_CLI_PREVIEW_COLUMNS")
        .or_else(|| parse_terminal_columns_override("COLUMNS"))
        .or_else(live_terminal_columns)
        .unwrap_or(120)
}

fn current_render_width() -> usize {
    current_terminal_columns()
        .min(MAX_RENDER_WIDTH)
        .max(MIN_RENDER_WIDTH)
}

fn output_width_class(columns: usize) -> OutputWidthClass {
    if columns <= 72 {
        OutputWidthClass::Narrow
    } else if columns <= 90 {
        OutputWidthClass::Compact
    } else {
        OutputWidthClass::Wide
    }
}

fn stderr_supports_unicode_animation() -> bool {
    if !stderr_supports_animation() {
        return false;
    }

    if matches!(env::var("TERM"), Ok(term) if term.eq_ignore_ascii_case("dumb")) {
        return false;
    }
    !cfg!(windows)
}

fn supports_unicode_output() -> bool {
    if matches!(env::var("TERM"), Ok(term) if term.eq_ignore_ascii_case("dumb")) {
        return false;
    }

    let locale = env::var("LC_ALL")
        .ok()
        .or_else(|| env::var("LANG").ok())
        .unwrap_or_default()
        .to_ascii_uppercase();
    if locale.contains("UTF-8") || locale.contains("UTF8") {
        return true;
    }

    !cfg!(windows)
}

fn section_divider_line() -> String {
    let divider_char = if supports_unicode_output() { '─' } else { '-' };
    divider_char.to_string().repeat(current_render_width())
}

fn info_glyph() -> &'static str {
    if supports_unicode_output() {
        "ℹ"
    } else {
        "i"
    }
}

fn next_glyph() -> &'static str {
    if supports_unicode_output() {
        "→"
    } else {
        ">"
    }
}

fn deposit_glyph() -> &'static str {
    if supports_unicode_output() {
        "↓"
    } else {
        "v"
    }
}

fn withdraw_glyph() -> &'static str {
    if supports_unicode_output() {
        "↑"
    } else {
        "^"
    }
}

fn recovery_glyph() -> &'static str {
    if supports_unicode_output() {
        "⟲"
    } else {
        "~"
    }
}

pub fn format_activity_direction_label(event_type: &str) -> String {
    let normalized = event_type.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "deposit" => format!("{} Deposit", styled_success(deposit_glyph())),
        "withdraw" | "withdrawal" => {
            format!("{} Withdraw", styled_accent(withdraw_glyph()))
        }
        "ragequit" | "exit" | "recovery" => {
            format!("{} Recovery", styled_notice(recovery_glyph()))
        }
        _ => title_case_words(event_type),
    }
}

fn table_horizontal_segment(width: usize) -> String {
    let fill = if supports_unicode_output() { '─' } else { '-' };
    fill.to_string().repeat(width)
}

struct TableChars {
    top_left: char,
    top_mid: char,
    top_right: char,
    mid_left: char,
    mid_mid: char,
    mid_right: char,
    bottom_left: char,
    bottom_mid: char,
    bottom_right: char,
    vertical: char,
}

fn table_chars() -> TableChars {
    if supports_unicode_output() {
        TableChars {
            top_left: '┌',
            top_mid: '┬',
            top_right: '┐',
            mid_left: '├',
            mid_mid: '┼',
            mid_right: '┤',
            bottom_left: '└',
            bottom_mid: '┴',
            bottom_right: '┘',
            vertical: '│',
        }
    } else {
        TableChars {
            top_left: '+',
            top_mid: '+',
            top_right: '+',
            mid_left: '+',
            mid_mid: '+',
            mid_right: '+',
            bottom_left: '+',
            bottom_mid: '+',
            bottom_right: '+',
            vertical: '|',
        }
    }
}

fn style_with_code(text: &str, code: &str) -> String {
    if stderr_supports_style() {
        format!("\x1b[{code}m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}

fn parse_terminal_columns_override(key: &str) -> Option<usize> {
    env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
}

fn live_terminal_columns() -> Option<usize> {
    terminal_size_of(io::stderr())
        .or_else(|| terminal_size_of(io::stdout()))
        .map(|(Width(width), _)| usize::from(width))
        .filter(|value| *value > 0)
}

fn title_case_words(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    trimmed
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    let mut rendered = String::new();
                    rendered.extend(first.to_uppercase());
                    rendered.push_str(&chars.as_str().to_ascii_lowercase());
                    rendered
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn styled_bold(text: &str) -> String {
    style_with_code(text, "1")
}

fn styled_dim(text: &str) -> String {
    style_with_code(text, "2")
}

fn styled_accent(text: &str) -> String {
    styled_palette_color(text, "38;2;80;172;255", "38;5;111")
}

fn styled_accent_bold(text: &str) -> String {
    styled_palette_color(text, "1;38;2;80;172;255", "1;38;5;111")
}

fn styled_notice(text: &str) -> String {
    styled_palette_color(text, "38;2;255;240;90", "38;5;227")
}

fn styled_success(text: &str) -> String {
    styled_palette_color(text, "38;2;124;242;154", "38;5;120")
}

fn styled_danger(text: &str) -> String {
    styled_palette_color(text, "38;2;255;138;128", "38;5;210")
}

fn styled_palette_color(text: &str, truecolor: &str, ansi256: &str) -> String {
    let code = if supports_truecolor_output() {
        truecolor
    } else {
        ansi256
    };
    style_with_code(text, code)
}

fn supports_truecolor_output() -> bool {
    match env::var("COLORTERM") {
        Ok(value) => {
            let lower = value.to_ascii_lowercase();
            lower.contains("truecolor") || lower.contains("24bit")
        }
        Err(_) => false,
    }
}

fn pad_display(value: &str, width: usize) -> String {
    let padding = width.saturating_sub(visible_width(value));
    format!("{value}{}", " ".repeat(padding))
}

fn wrap_text(value: &str, max_width: usize) -> Vec<String> {
    if max_width == 0 || visible_width(value) <= max_width {
        return vec![value.to_string()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();
    for word in value.split_whitespace() {
        let candidate = if current.is_empty() {
            word.to_string()
        } else {
            format!("{current} {word}")
        };
        if visible_width(&candidate) <= max_width {
            current = candidate;
            continue;
        }
        if !current.is_empty() {
            lines.push(current.clone());
            current.clear();
        }
        if visible_width(word) <= max_width {
            current = word.to_string();
            continue;
        }
        let mut remainder = word;
        while remainder.chars().count() > max_width {
            let chunk = remainder.chars().take(max_width).collect::<String>();
            let chunk_len = chunk.len();
            lines.push(chunk);
            remainder = &remainder[chunk_len..];
        }
        current = remainder.to_string();
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        vec![value.to_string()]
    } else {
        lines
    }
}

fn format_boxed_error(error: &CliError) -> String {
    let width = current_render_width().saturating_sub(4).max(24);
    let horizontal = if supports_unicode_output() { '─' } else { '-' };
    let vertical = if supports_unicode_output() { '│' } else { '|' };
    let top_left = if supports_unicode_output() { '╭' } else { '+' };
    let top_right = if supports_unicode_output() { '╮' } else { '+' };
    let bottom_left = if supports_unicode_output() { '╰' } else { '+' };
    let bottom_right = if supports_unicode_output() { '╯' } else { '+' };
    let failure_glyph = if supports_unicode_output() { "✗" } else { "x" };
    let mut content = Vec::new();
    let heading = styled_bold(&format!(
        "{}: {}",
        styled_danger(&format!("{failure_glyph} Error [{}]", error.category.as_str())),
        error.message
    ));
    content.extend(wrap_text(&heading, width));
    if let Some(hint) = &error.hint {
        content.extend(wrap_text(&styled_notice(&format!("Hint: {hint}")), width));
    }
    let content_width = content
        .iter()
        .map(|line| visible_width(line))
        .max()
        .unwrap_or(24)
        .max(24);
    let top = format!("{top_left}{}{top_right}", horizontal.to_string().repeat(content_width + 2));
    let bottom = format!(
        "{bottom_left}{}{bottom_right}",
        horizontal.to_string().repeat(content_width + 2)
    );
    let middle = content
        .iter()
        .map(|line| format!("{vertical} {} {vertical}", pad_display(line, content_width)))
        .collect::<Vec<_>>()
        .join("\n");
    format!("\n{top}\n{middle}\n{bottom}")
}

#[cfg(test)]
mod tests {
    use super::{
        format_activity_direction_label, format_callout, format_section_heading, print_table,
        CalloutKind,
    };

    #[test]
    fn format_callout_supports_success_and_privacy_labels() {
        let success = format_callout(CalloutKind::Success, &[String::from("Updated successfully.")]);
        assert!(success.contains("Success:"));
        assert!(success.contains("Updated successfully."));
        assert!(success.contains("│") || success.contains("|"));

        let privacy = format_callout(
            CalloutKind::Privacy,
            &[String::from("Private withdrawals still require approved balances.")],
        );
        assert!(privacy.contains("Privacy note:"));
        assert!(privacy.contains("approved balances"));
    }

    #[test]
    fn format_section_heading_uses_full_width_divider() {
        std::env::set_var("COLUMNS", "96");
        let heading = format_section_heading("Summary");
        assert!(heading.contains(&"─".repeat(96)) || heading.contains(&"-".repeat(96)));
    }

    #[test]
    fn print_table_uses_minimal_style() {
        std::env::set_var("COLUMNS", "120");
        print_table(
            vec!["Asset", "Balance"],
            vec![vec!["ETH".to_string(), "1.00".to_string()]],
        );
    }

    #[test]
    fn format_activity_direction_label_uses_semantic_glyphs() {
        let deposit = format_activity_direction_label("deposit");
        assert!(deposit.contains("Deposit"));
        assert!(deposit.contains("↓") || deposit.contains("v"));

        let withdraw = format_activity_direction_label("withdrawal");
        assert!(withdraw.contains("Withdraw"));
        assert!(withdraw.contains("↑") || withdraw.contains("^"));

        let recovery = format_activity_direction_label("ragequit");
        assert!(recovery.contains("Recovery"));
        assert!(recovery.contains("⟲") || recovery.contains("~"));
    }
}
