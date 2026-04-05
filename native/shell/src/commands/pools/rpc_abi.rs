use crate::error::CliError;
use num_bigint::BigUint;
use num_traits::{ToPrimitive, Zero};
use tiny_keccak::{Hasher, Keccak};

pub(super) fn function_selector(signature: &str) -> [u8; 4] {
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(signature.as_bytes());
    keccak.finalize(&mut hash);
    [hash[0], hash[1], hash[2], hash[3]]
}

pub(super) fn encode_address_word(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::input(
            format!("Invalid asset address: {address}."),
            Some("Use a 0x-prefixed 20-byte address.".to_string()),
        ));
    }
    Ok(format!("{:0>64}", normalized.to_lowercase()))
}

pub(super) fn decode_abi_words(hex_data: &str) -> Result<Vec<String>, CliError> {
    let normalized = hex_data.strip_prefix("0x").unwrap_or(hex_data);
    if normalized.is_empty() {
        return Ok(vec![]);
    }
    if !normalized.len().is_multiple_of(64) {
        return Err(CliError::rpc(
            "Malformed ABI response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(normalized
        .as_bytes()
        .chunks(64)
        .map(|chunk| String::from_utf8_lossy(chunk).to_string())
        .collect())
}

pub(super) fn decode_uint256_word(word: &str) -> BigUint {
    BigUint::parse_bytes(word.as_bytes(), 16).unwrap_or_else(BigUint::zero)
}

pub(super) fn decode_address_word(word: &str) -> Result<String, CliError> {
    if word.len() != 64 {
        return Err(CliError::rpc(
            "Malformed ABI address response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    Ok(format!("0x{}", &word[24..]))
}

pub(super) fn checksum_address(address: &str) -> Result<String, CliError> {
    let normalized = address.strip_prefix("0x").unwrap_or(address);
    if normalized.len() != 40 || !normalized.chars().all(|char| char.is_ascii_hexdigit()) {
        return Err(CliError::rpc(
            "Malformed address returned from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let lowercase = normalized.to_lowercase();
    let mut hash = [0u8; 32];
    let mut keccak = Keccak::v256();
    keccak.update(lowercase.as_bytes());
    keccak.finalize(&mut hash);
    let hash_hex = hex::encode(hash);
    let mut checksummed = String::from("0x");
    for (index, character) in lowercase.chars().enumerate() {
        let nibble = u8::from_str_radix(&hash_hex[index..index + 1], 16).unwrap_or(0);
        if character.is_ascii_alphabetic() && nibble >= 8 {
            checksummed.push(character.to_ascii_uppercase());
        } else {
            checksummed.push(character);
        }
    }
    Ok(checksummed)
}

pub(super) fn decode_abi_string(hex_data: &str) -> Result<String, CliError> {
    let words = decode_abi_words(hex_data)?;
    if words.len() < 2 {
        return Err(CliError::rpc(
            "Malformed ABI string response from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }

    let offset = decode_uint256_word(&words[0]).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string offset from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    if offset % 32 != 0 {
        return Err(CliError::rpc(
            "Invalid ABI string offset alignment from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        ));
    }
    let index = offset / 32;
    let length_word = words.get(index).ok_or_else(|| {
        CliError::rpc(
            "Malformed ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;
    let length = decode_uint256_word(length_word).to_usize().ok_or_else(|| {
        CliError::rpc(
            "Invalid ABI string length from RPC.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })?;

    let mut bytes = vec![];
    let required_words = length.div_ceil(32);
    for word_index in 0..required_words {
        let word = words.get(index + 1 + word_index).ok_or_else(|| {
            CliError::rpc(
                "Malformed ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        let decoded = hex::decode(word).map_err(|_| {
            CliError::rpc(
                "Invalid ABI string payload from RPC.",
                Some("Retry the command or switch RPC providers.".to_string()),
                Some("RPC_POOL_RESOLUTION_FAILED"),
            )
        })?;
        bytes.extend(decoded);
    }
    bytes.truncate(length);
    String::from_utf8(bytes).map_err(|_| {
        CliError::rpc(
            "ABI string payload was not valid UTF-8.",
            Some("Retry the command or switch RPC providers.".to_string()),
            Some("RPC_POOL_RESOLUTION_FAILED"),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_abi_string, decode_abi_words, encode_address_word};

    #[test]
    fn encode_address_word_rejects_invalid_addresses() {
        let error = encode_address_word("0x123").expect_err("expected invalid address");
        assert_eq!(error.code, "INPUT_ERROR");
    }

    #[test]
    fn decode_abi_words_rejects_misaligned_payloads() {
        let error = decode_abi_words("0x1234").expect_err("expected malformed abi payload");
        assert_eq!(error.code, "RPC_POOL_RESOLUTION_FAILED");
    }

    #[test]
    fn decode_abi_string_reads_dynamic_payloads() {
        let encoded = concat!(
            "0x",
            "0000000000000000000000000000000000000000000000000000000000000020",
            "0000000000000000000000000000000000000000000000000000000000000003",
            "4554480000000000000000000000000000000000000000000000000000000000"
        );
        assert_eq!(decode_abi_string(encoded).unwrap(), "ETH");
    }
}
