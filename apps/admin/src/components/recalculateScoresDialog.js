export async function showRecalculateScoresDialog(context) {
  const { supabase, setMsg } = context;

  const questionSetIdInput = prompt(
    "Enter Question Set ID to recalculate scores for:\n\n(Find this in the question set settings or database)"
  );

  if (!questionSetIdInput?.trim()) {
    return;
  }

  const questionSetId = questionSetIdInput.trim();

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(questionSetId)) {
    setMsg("Invalid UUID format");
    return;
  }

  const confirmed = window.confirm(
    `Recalculate scores for question set:\n\n${questionSetId}\n\nThis will:\n` +
    "• Compare all student answers against the current correct answers\n" +
    "• Update scores if correct answers were changed\n" +
    "• Preserve original attempt data\n\n" +
    "Continue?"
  );

  if (!confirmed) return;

  setMsg("Recalculating scores...");

  try {
    const { data, error } = await supabase
      .rpc("recalculate_question_set_scores", {
        p_question_set_id: questionSetId,
      });

    if (error) {
      console.error("recalculate scores error:", error);
      setMsg(`Error: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setMsg("No results returned from score recalculation");
      return;
    }

    const result = data[0];
    const summary =
      `✓ Score recalculation complete\n\n` +
      `Attempts processed: ${result.affected_attempts_count}\n` +
      `Scores updated: ${result.updated_attempts_count}\n` +
      `Score range: ${result.min_score_rate}% - ${result.max_score_rate}%\n` +
      `Average score: ${result.avg_score_rate}%`;

    setMsg(summary);
    console.log("Recalculation summary:", result);
  } catch (err) {
    console.error("Unexpected error during score recalculation:", err);
    setMsg(`Unexpected error: ${err.message}`);
  }
}

export async function showRecalculateTestInstanceScoresDialog(context) {
  const { supabase, setMsg } = context;

  const testInstanceIdInput = prompt(
    "Enter Test Instance ID to recalculate scores for:\n\n(Find this in the test instance settings)"
  );

  if (!testInstanceIdInput?.trim()) {
    return;
  }

  const testInstanceId = testInstanceIdInput.trim();

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(testInstanceId)) {
    setMsg("Invalid UUID format");
    return;
  }

  const confirmed = window.confirm(
    `Recalculate scores for test instance:\n\n${testInstanceId}\n\nThis will:\n` +
    "• Recalculate scores only for this specific test\n" +
    "• Compare answers against current correct answers\n" +
    "• Update only the affected attempts\n\n" +
    "Continue?"
  );

  if (!confirmed) return;

  setMsg("Recalculating scores...");

  try {
    const { data, error } = await supabase
      .rpc("recalculate_test_instance_scores", {
        p_test_instance_id: testInstanceId,
      });

    if (error) {
      console.error("recalculate test instance scores error:", error);
      setMsg(`Error: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      setMsg("No results returned from score recalculation");
      return;
    }

    const result = data[0];
    const summary =
      `✓ Score recalculation complete\n\n` +
      `Attempts processed: ${result.affected_attempts_count}\n` +
      `Scores updated: ${result.updated_attempts_count}\n` +
      `Score range: ${result.min_score_rate}% - ${result.max_score_rate}%\n` +
      `Average score: ${result.avg_score_rate}%`;

    setMsg(summary);
    console.log("Recalculation summary:", result);
  } catch (err) {
    console.error("Unexpected error during score recalculation:", err);
    setMsg(`Unexpected error: ${err.message}`);
  }
}
