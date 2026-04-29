use serde_json::Value;
use std::fmt;
use std::ops::Deref;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
// Keep the full CLI error taxonomy mirrored here even though the current
// native shell only constructs a subset of these categories today.
#[allow(dead_code)]
pub enum ErrorCategory {
    Cancelled,
    Input,
    Setup,
    Rpc,
    Asp,
    Relayer,
    Proof,
    Contract,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrorPresentation {
    Inline,
    Boxed,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
pub struct ErrorText(Box<str>);

impl ErrorText {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for ErrorText {
    fn from(value: String) -> Self {
        Self(value.into_boxed_str())
    }
}

impl From<&str> for ErrorText {
    fn from(value: &str) -> Self {
        Self(value.into())
    }
}

impl Deref for ErrorText {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.as_str()
    }
}

impl fmt::Display for ErrorText {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl PartialEq<&str> for ErrorText {
    fn eq(&self, other: &&str) -> bool {
        self.as_str() == *other
    }
}

impl ErrorCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCategory::Cancelled => "CANCELLED",
            ErrorCategory::Input => "INPUT",
            ErrorCategory::Setup => "SETUP",
            ErrorCategory::Rpc => "RPC",
            ErrorCategory::Asp => "ASP",
            ErrorCategory::Relayer => "RELAYER",
            ErrorCategory::Proof => "PROOF",
            ErrorCategory::Contract => "CONTRACT",
            ErrorCategory::Unknown => "UNKNOWN",
        }
    }

    pub fn exit_code(self) -> i32 {
        match self {
            ErrorCategory::Unknown => 1,
            ErrorCategory::Input => 2,
            ErrorCategory::Rpc => 3,
            ErrorCategory::Setup => 4,
            ErrorCategory::Relayer => 5,
            ErrorCategory::Proof => 6,
            ErrorCategory::Contract => 7,
            ErrorCategory::Asp => 8,
            ErrorCategory::Cancelled => 9,
        }
    }

    fn default_code(self) -> &'static str {
        match self {
            ErrorCategory::Cancelled => "PROMPT_CANCELLED",
            ErrorCategory::Input => "INPUT_ERROR",
            ErrorCategory::Setup => "SETUP_REQUIRED",
            ErrorCategory::Rpc => "RPC_ERROR",
            ErrorCategory::Asp => "ASP_ERROR",
            ErrorCategory::Relayer => "RELAYER_ERROR",
            ErrorCategory::Proof => "PROOF_ERROR",
            ErrorCategory::Contract => "CONTRACT_ERROR",
            ErrorCategory::Unknown => "UNKNOWN_ERROR",
        }
    }
}

#[derive(Clone, Debug)]
pub struct CliError {
    pub category: ErrorCategory,
    pub code: ErrorText,
    pub message: ErrorText,
    pub hint: Option<Box<str>>,
    pub retryable: bool,
    pub details: Option<Box<Value>>,
    pub next_actions: Option<Box<[Value]>>,
    pub docs_slug: Option<Box<str>>,
    pub help_topic: Option<Box<str>>,
    pub presentation: ErrorPresentation,
}

impl CliError {
    pub fn new(
        category: ErrorCategory,
        message: impl Into<String>,
        hint: Option<String>,
        code: Option<&str>,
        retryable: bool,
    ) -> Self {
        Self {
            category,
            code: ErrorText::from(code.unwrap_or_else(|| category.default_code())),
            message: ErrorText::from(message.into()),
            hint: hint.map(String::into_boxed_str),
            retryable,
            details: None,
            next_actions: None,
            docs_slug: None,
            help_topic: None,
            presentation: default_error_presentation(category),
        }
    }

    pub fn input(message: impl Into<String>, hint: impl Into<Option<String>>) -> Self {
        Self::new(ErrorCategory::Input, message, hint.into(), None, false)
    }

    pub fn input_with_code(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: &str,
    ) -> Self {
        Self::new(
            ErrorCategory::Input,
            message,
            hint.into(),
            Some(code),
            false,
        )
    }

    pub fn rpc(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
    ) -> Self {
        Self::new(ErrorCategory::Rpc, message, hint.into(), code, false)
    }

    pub fn rpc_retryable(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
    ) -> Self {
        Self::new(ErrorCategory::Rpc, message, hint.into(), code, true)
    }

    pub fn asp(
        message: impl Into<String>,
        hint: impl Into<Option<String>>,
        code: Option<&str>,
        retryable: bool,
    ) -> Self {
        Self::new(ErrorCategory::Asp, message, hint.into(), code, retryable)
    }

    pub fn unknown(message: impl Into<String>, hint: impl Into<Option<String>>) -> Self {
        Self::new(ErrorCategory::Unknown, message, hint.into(), None, false)
    }

    pub fn with_docs_slug(mut self, docs_slug: impl Into<String>) -> Self {
        self.docs_slug = Some(docs_slug.into().into_boxed_str());
        self
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(Box::new(details));
        self
    }

    pub fn next_actions(&self) -> &[Value] {
        self.next_actions.as_deref().unwrap_or(&[])
    }

    pub fn push_next_action(&mut self, value: Value) {
        let mut actions = self.next_actions.take().map(Vec::from).unwrap_or_default();
        actions.push(value);
        self.next_actions = Some(actions.into_boxed_slice());
    }
}

fn default_error_presentation(category: ErrorCategory) -> ErrorPresentation {
    match category {
        ErrorCategory::Cancelled
        | ErrorCategory::Input
        | ErrorCategory::Setup
        | ErrorCategory::Rpc
        | ErrorCategory::Asp => ErrorPresentation::Inline,
        ErrorCategory::Relayer
        | ErrorCategory::Proof
        | ErrorCategory::Contract
        | ErrorCategory::Unknown => ErrorPresentation::Boxed,
    }
}
