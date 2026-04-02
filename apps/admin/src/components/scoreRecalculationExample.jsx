/**
 * Example: How to integrate score recalculation into your admin testing page
 *
 * This example shows the minimal code needed to add score recalculation
 * buttons to your existing admin testing management interface.
 */

import {
  showRecalculateScoresDialog,
  showRecalculateTestInstanceScoresDialog,
} from './recalculateScoresDialog';

/**
 * Example 1: Add buttons to your testing management section
 *
 * Place these buttons alongside your existing test management buttons
 */
export function ScoreRecalculationSection({ context }) {
  return (
    <div className="score-recalculation-section">
      <h3>Score Management</h3>
      <p className="help-text">
        Use these tools to recalculate student scores after correcting answer keys.
      </p>

      <div className="button-group">
        <button
          className="btn btn-warning"
          onClick={() => showRecalculateScoresDialog(context)}
          title="Recalculate scores for all attempts using a specific question set"
        >
          Recalculate by Question Set
        </button>

        <button
          className="btn btn-warning"
          onClick={() => showRecalculateTestInstanceScoresDialog(context)}
          title="Recalculate scores for a specific test instance only"
        >
          Recalculate by Test Instance
        </button>
      </div>

      <details className="help-details">
        <summary>Help: When to use each option</summary>
        <ul>
          <li>
            <strong>Question Set:</strong> Use when you've corrected an answer in
            the question set itself. This recalculates for ALL attempts that used
            this question set.
          </li>
          <li>
            <strong>Test Instance:</strong> Use to recalculate only for a specific
            test (daily test, model test, etc.). Useful if only one test instance
            was affected.
          </li>
        </ul>
      </details>
    </div>
  );
}

/**
 * Example 2: Integrate into your existing testing page component
 *
 * Add this to your admin testing management page:
 */
export function ExampleAdminTestingPageIntegration() {
  // Your existing context and state
  const context = {
    supabase: supabaseClient,
    setMsg: setTestingMsg,
    // ... other context properties
  };

  return (
    <div className="admin-testing-page">
      {/* Your existing testing management UI */}

      {/* Add this new section for score recalculation */}
      <section className="testing-section">
        <ScoreRecalculationSection context={context} />
      </section>

      {/* Your other sections */}
    </div>
  );
}

/**
 * Example 3: Add a menu option to access score recalculation
 *
 * If you have a testing actions menu, add this option:
 */
export const TESTING_MENU_OPTIONS = [
  // ... your existing options
  {
    label: 'Recalculate Scores',
    icon: 'refresh',
    submenu: [
      {
        label: 'By Question Set',
        action: (context) => showRecalculateScoresDialog(context),
        requiresAdmin: true,
      },
      {
        label: 'By Test Instance',
        action: (context) => showRecalculateTestInstanceScoresDialog(context),
        requiresAdmin: true,
      },
    ],
  },
];

/**
 * Example 4: Custom context if needed
 *
 * If you need to customize the context, create it like this:
 */
export function createScoreRecalculationContext(supabase, setMsg) {
  return {
    supabase,
    setMsg,
    // You can add additional context properties here if needed
  };
}

/**
 * Example 5: With audit logging (if you have an audit system)
 *
 * Wrap the recalculation with audit logging:
 */
export async function showRecalculateScoresWithAudit(context) {
  const { supabase, setMsg, recordAuditEvent } = context;

  const questionSetIdInput = prompt('Enter Question Set ID:');
  if (!questionSetIdInput?.trim()) return;

  const questionSetId = questionSetIdInput.trim();

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(questionSetId)) {
    setMsg('Invalid UUID format');
    return;
  }

  const confirmed = window.confirm(
    `Recalculate scores for question set ${questionSetId}?`
  );
  if (!confirmed) return;

  setMsg('Recalculating scores...');

  try {
    const { data, error } = await supabase.rpc(
      'recalculate_question_set_scores',
      { p_question_set_id: questionSetId }
    );

    if (error) throw error;

    const result = data?.[0];
    if (!result) {
      setMsg('No results returned');
      return;
    }

    // Log to audit trail
    if (recordAuditEvent) {
      await recordAuditEvent({
        actionType: 'recalculate',
        entityType: 'scores',
        entityId: `question-set:${questionSetId}`,
        summary: `Recalculated ${result.updated_attempts_count} scores`,
        metadata: {
          question_set_id: questionSetId,
          affected_attempts: result.affected_attempts_count,
          updated_attempts: result.updated_attempts_count,
          new_avg_score: result.avg_score_rate,
        },
      });
    }

    const summary =
      `✓ Recalculation complete\n\n` +
      `Processed: ${result.affected_attempts_count}\n` +
      `Updated: ${result.updated_attempts_count}\n` +
      `Range: ${result.min_score_rate}% - ${result.max_score_rate}%\n` +
      `Average: ${result.avg_score_rate}%`;

    setMsg(summary);
  } catch (err) {
    console.error('Error:', err);
    setMsg(`Error: ${err.message}`);
  }
}

// CSS for styling (optional)
const styles = `
.score-recalculation-section {
  padding: 20px;
  background-color: #f9f9f9;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin: 20px 0;
}

.score-recalculation-section h3 {
  margin-top: 0;
  color: #333;
}

.score-recalculation-section .help-text {
  color: #666;
  font-size: 14px;
  margin: 10px 0;
}

.button-group {
  display: flex;
  gap: 10px;
  margin: 15px 0;
}

.button-group button {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background-color: #ff9800;
  color: white;
  cursor: pointer;
  font-weight: bold;
}

.button-group button:hover {
  background-color: #f57c00;
}

.help-details {
  margin-top: 15px;
  padding: 10px;
  background-color: #e3f2fd;
  border-left: 4px solid #2196f3;
  border-radius: 2px;
}

.help-details summary {
  cursor: pointer;
  color: #1976d2;
  font-weight: bold;
}

.help-details ul {
  margin-top: 10px;
  padding-left: 20px;
}

.help-details li {
  margin: 8px 0;
  color: #555;
}
`;
