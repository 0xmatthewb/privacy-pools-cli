#[derive(Clone, Copy, Debug, PartialEq, Eq)]
// Keep the full CLI error taxonomy mirrored here even though the current
// native shell only constructs a subset of these categories today.
#[allow(dead_code)]
pub enum ErrorCategory {
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

impl ErrorCategory {
    pub fn as_str(self) -> &'static str {
        match self {
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
        }
    }

    fn default_code(self) -> &'static str {
        match self {
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
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
    pub retryable: bool,
    pub docs_slug: Option<String>,
    pub help_topic: Option<String>,
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
        let category_code = category.default_code().to_string();
        Self {
            category,
            code: code.unwrap_or(&category_code).to_string(),
            message: message.into(),
            hint,
            retryable,
            docs_slug: None,
            help_topic: None,
            presentation: default_error_presentation(category),
        }
    }

    pub fn input(message: impl Into<String>, hint: impl Into<Option<String>>) -> Self {
        Self::new(ErrorCategory::Input, message, hint.into(), None, false)
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
        self.docs_slug = Some(docs_slug.into());
        self
    }

}

fn default_error_presentation(category: ErrorCategory) -> ErrorPresentation {
    match category {
        ErrorCategory::Input
        | ErrorCategory::Setup
        | ErrorCategory::Rpc
        | ErrorCategory::Asp => ErrorPresentation::Inline,
        ErrorCategory::Relayer
        | ErrorCategory::Proof
        | ErrorCategory::Contract
        | ErrorCategory::Unknown => ErrorPresentation::Boxed,
    }
}
