use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

struct ChangingDiscovery {
    corrected: Arc<AtomicBool>,
    searches: Arc<AtomicUsize>,
}

fn discovered_definition(corrected: bool) -> Value {
    json!({
        "type":"function", "name":"commons_get_conversation", "strict":true,
        "parameters":{
            "type":"object", "properties":{"before_message_id":{"type":["integer", "null"]}},
            "required": if corrected { vec!["before_message_id"] } else { vec![] },
            "additionalProperties":false
        }
    })
}

#[nanocodex_tools::contract::async_trait]
impl nanocodex_tools::Tool for ChangingDiscovery {
    fn definition(&self) -> nanocodex_tools::ToolDefinition {
        nanocodex_tools::ToolDefinition::tool_search(
            "client",
            "Find conversation tools.",
            json!({"type":"object", "properties":{"query":{"type":"string"}},
                "required":["query"], "additionalProperties":false}),
        )
    }

    async fn execute(
        &self,
        _input: nanocodex_tools::ToolInput,
        _context: nanocodex_tools::ToolContext<'_>,
    ) -> nanocodex_tools::ToolResult {
        self.searches.fetch_add(1, Ordering::SeqCst);
        Ok(nanocodex_tools::ToolOutput::json(&json!([
            discovered_definition(self.corrected.load(Ordering::SeqCst)),
            {"type":"function", "name":"valid_sibling", "parameters":{"type":"object"}}
        ])))
    }
}

#[tokio::test]
async fn rejected_schema_repairs_durable_history_after_incremental_request() -> Result<()> {
    rejected_schema_repairs_durable_history(false).await
}

#[tokio::test]
async fn rejected_schema_uses_full_replay_indices_after_checkpoint_loss() -> Result<()> {
    rejected_schema_repairs_durable_history(true).await
}

async fn rejected_schema_repairs_durable_history(lose_checkpoint: bool) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let endpoint = format!("ws://{}", listener.local_addr()?);
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await?;
        let mut socket = accept_async(stream).await?;
        let _warmup = next_json(&mut socket).await?;
        send_warmup(&mut socket, "resp-warmup").await?;
        let _generation = next_json(&mut socket).await?;
        send_json(
            &mut socket,
            completed_response(
                "resp-search",
                &[json!({
                    "type":"tool_search_call", "id":"tsc-old", "call_id":"search-old",
                    "execution":"client", "arguments":{"query":"conversation"}
                })],
            ),
        )
        .await?;
        let mut request = next_json(&mut socket).await?;
        assert_eq!(request["input"][0]["type"], "tool_search_output");
        assert!(request.get("previous_response_id").is_some());
        if lose_checkpoint {
            send_json(
                &mut socket,
                json!({"type":"error", "error":{
                    "code":"previous_response_not_found", "message":"checkpoint expired"
                }}),
            )
            .await?;
            request = next_json(&mut socket).await?;
            assert!(request.get("previous_response_id").is_none());
        }
        let input = request["input"].as_array().unwrap();
        let index = input
            .iter()
            .position(|item| item["type"] == "tool_search_output")
            .unwrap();
        assert_eq!(index > 0, lose_checkpoint);
        let old_output_id = input[index]["id"].clone();
        assert_eq!(input[index]["tools"][0], discovered_definition(false));
        send_json(
            &mut socket,
            json!({"type":"error", "status":400, "error":{
                "code":"invalid_function_parameters", "type":"invalid_request_error",
                "param":format!("input[{index}].tools[0].parameters"),
                "message":"Missing required before_message_id"
            }}),
        )
        .await?;
        // No automatic retry of this rejected model request or its tools.
        let (stream, _) = listener.accept().await?;
        let mut resumed = accept_async(stream).await?;
        let replay = next_json(&mut resumed).await?;
        assert!(replay.get("previous_response_id").is_none());
        assert!(replay.to_string().contains("original mention"));
        assert!(
            replay
                .to_string()
                .contains("continue after catalog correction")
        );
        let history = replay["input"].as_array().unwrap();
        assert!(
            history
                .iter()
                .any(|item| item["type"] == "tool_search_call" && item["call_id"] == "search-old")
        );
        let old_output = history
            .iter()
            .find(|item| item["type"] == "tool_search_output")
            .unwrap();
        assert_eq!(old_output["id"], old_output_id);
        assert_eq!(old_output["call_id"], "search-old");
        assert_eq!(old_output["tools"].as_array().unwrap().len(), 1);
        assert_eq!(old_output["tools"][0]["name"], "valid_sibling");
        send_json(
            &mut resumed,
            completed_response(
                "resp-rediscovery",
                &[json!({
                    "type":"tool_search_call", "call_id":"search-new", "execution":"client",
                    "arguments":{"query":"conversation"}
                })],
            ),
        )
        .await?;
        let corrected = next_json(&mut resumed).await?;
        assert_eq!(corrected["input"][0]["call_id"], "search-new");
        assert_eq!(
            corrected["input"][0]["tools"][0],
            discovered_definition(true)
        );
        send_final(&mut resumed, "resp-recovered").await
    });

    let workspace = temporary_workspace("rejected-tool-schema")?;
    let rollout_home = temporary_workspace("rejected-tool-schema-rollout")?;
    let corrected = Arc::new(AtomicBool::new(false));
    let searches = Arc::new(AtomicUsize::new(0));
    let tools = || {
        Tools::builder()
            .without_defaults()
            .tool(ChangingDiscovery {
                corrected: Arc::clone(&corrected),
                searches: Arc::clone(&searches),
            })
            .build()
    };
    let openai = || OpenAi::builder("test-key").websocket_url(&endpoint).build();
    let (agent, events) = Nanocodex::builder(openai()?)
        .thinking(Thinking::Low)
        .workspace(&workspace)
        .session_id(test_session_id())
        .tools(tools()?)
        .rollout(RolloutConfig::new(&rollout_home))
        .build()?;
    drop(events);
    let error = agent
        .prompt("original mention")
        .await?
        .result()
        .await
        .expect_err("schema rejection must fail the turn");
    assert_eq!(
        error
            .responses_error()
            .and_then(ResponsesError::rejected_tool_definition),
        Some(&discovered_definition(false))
    );
    assert_eq!(searches.load(Ordering::SeqCst), 1);
    agent.shutdown().await?;
    drop(agent);
    let durable = RolloutConfig::new(&rollout_home).load_session(TEST_SESSION_ID)?;
    let snapshot = serde_json::to_value(durable.snapshot())?;
    let history = snapshot["history"].as_array().unwrap();
    let discovery = history
        .iter()
        .find(|item| item["type"] == "tool_search_output")
        .unwrap();
    assert_eq!(discovery["tools"].as_array().unwrap().len(), 1);
    assert_eq!(discovery["tools"][0]["name"], "valid_sibling");
    corrected.store(true, Ordering::SeqCst);
    let (thread_id, snapshot, rollout) = durable.into_parts();
    let (resumed, events) = Nanocodex::builder(openai()?)
        .thinking(Thinking::Low)
        .session_id(thread_id.parse()?)
        .resume(snapshot)
        .tools(tools()?)
        .rollout(rollout)
        .build()?;
    drop(events);
    assert_eq!(
        resumed
            .prompt("continue after catalog correction")
            .await?
            .result()
            .await?
            .final_message(),
        "done"
    );
    assert_eq!(searches.load(Ordering::SeqCst), 2);
    resumed.shutdown().await?;
    drop(resumed);
    timeout(std::time::Duration::from_secs(5), server)
        .await
        .map_err(|_| eyre!("schema recovery mock did not finish"))???;
    std::fs::remove_dir_all(workspace)?;
    std::fs::remove_dir_all(rollout_home)?;
    Ok(())
}
