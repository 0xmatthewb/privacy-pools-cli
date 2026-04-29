#![allow(dead_code)]

use crate::error::{CliError, ErrorCategory};

pub const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";
pub const ZERO_ADDRESS_CHECKSUMMED: &str = ZERO_ADDRESS;
pub const LOW_BURN_ADDRESS: &str = "0x000000000000000000000000000000000000dead";
pub const HIGH_BURN_ADDRESS: &str = "0xdead000000000000000000000000000000000000";

pub fn is_burn_recipient_address(address: &str) -> bool {
    let normalized = address.to_ascii_lowercase();
    normalized == ZERO_ADDRESS || normalized == LOW_BURN_ADDRESS || normalized == HIGH_BURN_ADDRESS
}

pub fn assert_safe_recipient_address(address: &str, label: &str) -> Result<(), CliError> {
    if is_burn_recipient_address(address) {
        return Err(CliError::new(
            ErrorCategory::Input,
            format!("{label} appears to be a burn address."),
            Some(
                "Provide a recipient you control. Obvious zero, burn, or dead-address patterns would make funds unrecoverable."
                    .to_string(),
            ),
            Some("INPUT_RECIPIENT_BURN_ADDRESS"),
            false,
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{assert_safe_recipient_address, LOW_BURN_ADDRESS};

    #[test]
    fn recipient_safety_rejects_mixed_case_burn_before_checksum_normalization() {
        let mixed_case = LOW_BURN_ADDRESS.replace("dead", "dEaD");
        let error = assert_safe_recipient_address(&mixed_case, "Recipient")
            .expect_err("mixed-case burn address should be rejected");

        assert_eq!(error.code.as_str(), "INPUT_RECIPIENT_BURN_ADDRESS");
        assert_eq!(error.category.as_str(), "INPUT");
        assert!(error.message.as_str().contains("burn address"));
    }
}
