mod format;
mod model;
mod normalize;
mod options;
mod render;

use crate::commands::pools::{default_read_only_chains, resolve_pool_native};
use crate::config::{load_config, resolve_chain};
use crate::contract::Manifest;
use crate::error::CliError;
use crate::json::parse_json_u64;
use crate::output::start_spinner;
use crate::parse_timeout_ms;
use crate::read_only_api::{fetch_global_events, fetch_pool_events};
use crate::root_argv::ParsedRootArgv;
use crate::routing::resolve_mode;
use model::ActivityRenderData;
use normalize::normalize_activity_events;
use options::parse_activity_options;
use render::render_activity_output;
use serde_json::{Map, Value};

fn normalize_asp_page(raw_page: Option<u64>, requested_page: u64) -> u64 {
    match raw_page {
        None => requested_page,
        Some(value) if requested_page > 0 && value + 1 == requested_page => value + 1,
        Some(0) => requested_page,
        Some(value) => value,
    }
}

fn derive_known_total_pages(
    total: Option<u64>,
    per_page: u64,
    reported_total_pages: Option<u64>,
) -> Option<u64> {
    if let Some(total) = total {
        if per_page > 0 {
            return Some(std::cmp::max(1, total.div_ceil(per_page)));
        }
    }
    reported_total_pages
}

pub fn handle_activity_native(
    argv: &[String],
    parsed: &ParsedRootArgv,
    manifest: &Manifest,
) -> Result<i32, CliError> {
    let opts = parse_activity_options(argv)?;
    let result = (|| -> Result<i32, CliError> {
        let mode = resolve_mode(parsed);
        let timeout_ms = parse_timeout_ms(argv);
        let mut loading = (!mode.is_json() && !mode.is_quiet)
            .then(|| start_spinner("Fetching public activity..."));

        if let Some(asset) = opts.asset.as_deref() {
            let config = load_config()?;
            let explicit_chain = parsed
                .global_chain()
                .unwrap_or_else(|| config.default_chain.clone());
            let chain = resolve_chain(&explicit_chain, manifest)?;
            let pool = resolve_pool_native(
                &chain,
                asset,
                parsed.global_rpc_url(),
                &config,
                manifest,
                timeout_ms,
            )?;
            let response =
                fetch_pool_events(&chain, &pool.scope, opts.page, opts.per_page, timeout_ms)?;
            let events = normalize_activity_events(
                response
                    .get("events")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([])),
                Some(pool.symbol.as_str()),
                manifest,
            )?;
            let page = normalize_asp_page(parse_json_u64(response.get("page")), opts.page);
            let per_page = parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page);
            let total = parse_json_u64(response.get("total"));
            let total_pages = derive_known_total_pages(
                total,
                per_page,
                parse_json_u64(response.get("totalPages")),
            );
            if let Some(spinner) = loading.as_mut() {
                spinner.stop();
            }
            render_activity_output(
                &mode,
                ActivityRenderData {
                    mode: "pool-activity",
                    chain: chain.name.clone(),
                    chains: None,
                    page,
                    per_page,
                    total,
                    total_pages,
                    events,
                    asset: Some(pool.symbol),
                    pool: Some(pool.pool_address),
                    scope: Some(pool.scope),
                    chain_filtered: false,
                },
            );
            return Ok(0);
        }

        if let Some(explicit_chain) = parsed.global_chain() {
            let chain = resolve_chain(&explicit_chain, manifest)?;
            let response = fetch_global_events(&chain, opts.page, opts.per_page, timeout_ms)?;
            let events = normalize_activity_events(
                response
                    .get("events")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!([])),
                None,
                manifest,
            )?
            .into_iter()
            .filter(|event| event.chain_id.is_none() || event.chain_id == Some(chain.id))
            .collect::<Vec<_>>();
            if let Some(spinner) = loading.as_mut() {
                spinner.stop();
            }
            render_activity_output(
                &mode,
                ActivityRenderData {
                    mode: "global-activity",
                    chain: chain.name,
                    chains: None,
                    page: normalize_asp_page(parse_json_u64(response.get("page")), opts.page),
                    per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
                    total: None,
                    total_pages: None,
                    events,
                    asset: None,
                    pool: None,
                    scope: None,
                    chain_filtered: true,
                },
            );
            return Ok(0);
        }

        let chains = default_read_only_chains(manifest);
        let representative_chain = chains.first().ok_or_else(|| {
            CliError::unknown(
                "No default read-only chains configured.",
                Some("Regenerate the native command manifest.".to_string()),
            )
        })?;
        let response =
            fetch_global_events(representative_chain, opts.page, opts.per_page, timeout_ms)?;
        let events = normalize_activity_events(
            response
                .get("events")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([])),
            None,
            manifest,
        )?;

        if let Some(spinner) = loading.as_mut() {
            spinner.stop();
        }
        render_activity_output(
            &mode,
            ActivityRenderData {
                mode: "global-activity",
                chain: "all-mainnets".to_string(),
                chains: Some(
                    chains
                        .iter()
                        .map(|chain| chain.name.clone())
                        .collect::<Vec<_>>(),
                ),
                page: normalize_asp_page(parse_json_u64(response.get("page")), opts.page),
                per_page: parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
                total: parse_json_u64(response.get("total")),
                total_pages: derive_known_total_pages(
                    parse_json_u64(response.get("total")),
                    parse_json_u64(response.get("perPage")).unwrap_or(opts.per_page),
                    parse_json_u64(response.get("totalPages")),
                ),
                events,
                asset: None,
                pool: None,
                scope: None,
                chain_filtered: false,
            },
        );

        Ok(0)
    })();

    result.map_err(|mut error| {
        if error.retryable {
            let mut action_options = Map::new();
            if parsed.is_structured_output_mode {
                action_options.insert("agent".to_string(), Value::Bool(true));
            }
            action_options.insert("page".to_string(), Value::Number(opts.page.into()));
            action_options.insert("limit".to_string(), Value::Number(opts.per_page.into()));
            if let Some(explicit_chain) = parsed.global_chain() {
                action_options.insert("chain".to_string(), Value::String(explicit_chain));
            }

            let asset_args = opts.asset.as_deref().map(|asset| [asset]);
            error.push_next_action(crate::output::build_next_action(
                "activity",
                "Retry the public activity query.",
                "after_activity",
                asset_args.as_ref().map(|args| args.as_slice()),
                Some(&action_options),
                None,
            ));
        }

        error
    })
}
