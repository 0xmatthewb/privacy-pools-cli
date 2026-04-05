use serde_json::Value;

pub(crate) fn json_numberish(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(string) => string.trim().parse::<f64>().ok(),
        _ => None,
    }
}

pub(crate) fn parse_json_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(json_numberish).and_then(|value| {
        if value.is_finite() && value >= 0.0 {
            Some(value as u64)
        } else {
            None
        }
    })
}
