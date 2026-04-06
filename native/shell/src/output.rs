use serde_json::{json, Map, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::contract::manifest;
use crate::error::CliError;

pub fn emit_help(text: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "help",
            "help": text.trim_end()
        }));
    } else {
        write_stdout_text(text);
    }
}

pub fn emit_version(version: &str, structured: bool) {
    if structured {
        print_json_success(json!({
            "mode": "version",
            "version": version
        }));
    } else {
        std::io::Write::write_all(&mut std::io::stdout(), format!("{version}\n").as_bytes()).ok();
    }
}

pub fn write_stdout_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stdout(), value.as_bytes()).ok();
}

pub fn write_stderr_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with('\n') {
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stderr(), value.as_bytes()).ok();
}

pub fn write_stderr_block_text(text: &str) {
    let mut value = text.to_string();
    if !value.ends_with("\n\n") {
        value.push('\n');
        value.push('\n');
    }
    std::io::Write::write_all(&mut std::io::stderr(), value.as_bytes()).ok();
}

pub fn format_section_heading(title: &str) -> String {
    format!("\n{}\n{}:\n", "─".repeat(18), title)
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
        output.push_str(&format!(
            "  {:<width$} {}\n",
            format!("{label}:"),
            value,
            width = width
        ));
    }
    output
}

fn json_schema_version() -> &'static str {
    manifest().json_schema_version.as_str()
}

pub fn print_json_success(payload: Value) {
    let mut object = payload.as_object().cloned().unwrap_or_default();
    object.insert(
        "schemaVersion".to_string(),
        Value::String(json_schema_version().to_string()),
    );
    object.insert("success".to_string(), Value::Bool(true));
    let output = Value::Object(object);
    write_stdout_text(&serde_json::to_string(&output).expect("json success must serialize"));
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
        write_stderr_text(&format!(
            "Error [{}]: {}",
            error.category.as_str(),
            error.message
        ));
        if let Some(hint) = &error.hint {
            write_stderr_text(&format!("Hint: {hint}"));
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
        .map(|header| header.chars().count())
        .collect::<Vec<_>>();
    for row in &rows {
        for (index, cell) in row.iter().enumerate() {
            widths[index] = widths[index].max(cell.chars().count());
        }
    }

    let top = table_border('┌', '┬', '┐', &widths);
    let middle = table_border('├', '┼', '┤', &widths);
    let bottom = table_border('└', '┴', '┘', &widths);
    let header_row = table_row(&headers, &widths);

    let mut output = String::new();
    output.push_str(&top);
    output.push('\n');
    output.push_str(&header_row);
    output.push('\n');
    output.push_str(&middle);
    if rows.is_empty() {
        output.push('\n');
        output.push_str(&bottom);
        write_stderr_text(&output);
        return;
    }

    output.push('\n');
    for (index, row) in rows.iter().enumerate() {
        output.push_str(&table_row(row, &widths));
        if index + 1 < rows.len() {
            output.push('\n');
            output.push_str(&middle);
            output.push('\n');
        } else {
            output.push('\n');
        }
    }
    output.push_str(&bottom);
    write_stderr_text(&output);
}

pub fn write_info(message: &str) {
    write_stderr_text(&format!("ℹ {message}"));
}

pub fn write_warn(message: &str) {
    write_stderr_text(&format!("⚠ {message}"));
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
        .map(|width| "─".repeat(width + 2))
        .collect::<Vec<_>>();
    format!("{left}{}{right}", segments.join(&middle.to_string()))
}

fn table_row(row: &[String], widths: &[usize]) -> String {
    let cells = row
        .iter()
        .enumerate()
        .map(|(index, cell)| {
            let padding = widths[index].saturating_sub(cell.chars().count());
            format!(" {}{} ", cell, " ".repeat(padding))
        })
        .collect::<Vec<_>>();
    format!("│{}│", cells.join("│"))
}
