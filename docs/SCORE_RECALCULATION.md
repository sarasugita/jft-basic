# Score Recalculation Guide

## Overview

After correcting answers in a question set, you can recalculate student scores to reflect the updated correct answers. This process compares all student submissions against the new correct answers and updates their scores accordingly.

## Use Cases

- **Correcting answer keys**: When you discover the official answer to a question was wrong
- **Clarifying ambiguous questions**: When a question had multiple valid interpretations
- **Test maintenance**: After making corrections to the question set

## How It Works

1. The function retrieves all attempts for the given question set
2. For each attempt, it compares student answers against **current** correct answers
3. Recalculates `correct`, `total`, and `score_rate` fields
4. Only updates attempts where the score actually changed
5. Preserves all original attempt data (student answers, timestamps, etc.)

## Functions

### `recalculate_question_set_scores(question_set_id)`

Recalculates scores for **all attempts** using a specific question set.

**Parameters:**
- `question_set_id` (UUID): The question set ID to recalculate

**Returns:**
- `affected_attempts_count` (int): Total attempts processed
- `updated_attempts_count` (int): Number of attempts with changed scores
- `min_score_rate` (numeric): Lowest score after recalculation (%)
- `max_score_rate` (numeric): Highest score after recalculation (%)
- `avg_score_rate` (numeric): Average score after recalculation (%)

**Example:**
```sql
select * from public.recalculate_question_set_scores(
  'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6'::uuid
);
```

### `recalculate_test_instance_scores(test_instance_id)`

Recalculates scores for attempts in a **specific test instance** only.

**Parameters:**
- `test_instance_id` (UUID): The test instance ID to recalculate

**Returns:** Same as above

**Example:**
```sql
select * from public.recalculate_test_instance_scores(
  'x1y2z3w4-a5b6-47c8-d9e0-f1g2h3i4j5k6'::uuid
);
```

## How to Use (Admin UI)

1. Go to the Admin Console
2. Find the "Recalculate Scores" option in the testing management section
3. Choose between:
   - **Question Set**: Recalculate for all attempts using this question set
   - **Test Instance**: Recalculate for a specific test/day
4. Enter the UUID and confirm
5. Review the summary:
   - Number of attempts processed
   - Number of scores that changed
   - New score statistics (min, max, average)

## How to Use (SQL Query)

Connect to your Supabase database and run:

```sql
-- Recalculate by question set
select * from public.recalculate_question_set_scores(
  'YOUR_QUESTION_SET_ID'::uuid
);

-- Recalculate by test instance
select * from public.recalculate_test_instance_scores(
  'YOUR_TEST_INSTANCE_ID'::uuid
);
```

## Finding IDs

### Question Set ID
```sql
-- Find all question sets
select id, title, version, created_at
from public.question_sets
order by created_at desc
limit 10;
```

### Test Instance ID
```sql
-- Find all test instances for a specific school
select id, school_id, question_set_id, start_date, created_at
from public.test_instances
where school_id = 'YOUR_SCHOOL_ID'::uuid
order by created_at desc
limit 10;
```

## Important Notes

### Permissions
- Only **super_admin** users can execute these functions
- The function checks permissions and will reject non-admin attempts

### Data Preservation
- Original student answers are **never modified**
- Only `correct`, `total`, and `score_rate` are updated
- All timestamps remain unchanged
- Audit logs can track who ran recalculation and when

### Performance
- The function runs efficiently even for large question sets
- Processes all attempts in a single SQL operation
- Returns in seconds for typical test sizes

### Safety
- No permanent changes until you confirm
- Review the summary before running on production
- For a "dry run", you can query what scores would change:

```sql
-- Preview what would change
with calculated_scores as (
  select
    a.id,
    a.correct as old_correct,
    a.score_rate as old_score_rate,
    coalesce(
      (select count(*)::int
       from public.question_set_questions qsq
       where qsq.question_set_id = 'YOUR_QUESTION_SET_ID'::uuid
         and jsonb_typeof(a.answers_json -> qsq.id::text) = 'number'
         and (a.answers_json ->> (qsq.id::text))::int = (qsq.correct_answer::int)
      ),
      0
    ) as new_correct
  from public.attempts a
  where a.question_set_id = 'YOUR_QUESTION_SET_ID'::uuid
)
select
  id,
  old_correct,
  new_correct,
  old_score_rate,
  case when new_correct > 0 
    then (new_correct::numeric / 
      (select count(*)::int from public.question_set_questions 
       where question_set_id = 'YOUR_QUESTION_SET_ID'::uuid) * 100)::numeric(5,2)
    else 0 
  end as new_score_rate
from calculated_scores
where new_correct != old_correct
order by old_correct desc;
```

## Workflow Example

1. **Discover an answer error:**
   - Question 5 of Daily Test v2.1 had the wrong answer key

2. **Correct the answer:**
   - Update `question_set_questions.correct_answer` for question 5

3. **Recalculate scores:**
   ```sql
   select * from public.recalculate_question_set_scores(
     'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6'::uuid
   );
   ```

4. **Review results:**
   - 200 attempts processed
   - 45 scores updated (students who had different answers)
   - Average score increased from 72% to 73%

5. **Document the change:**
   - Log: "Corrected Q5 answer from option B to option D, recalculated 200 attempts"
   - Notify students (optional): "Question 5 answer was corrected, scores updated"

## Troubleshooting

### "permission denied" error
- Make sure you're logged in as super_admin
- Check that your Supabase credentials have the right role

### "question set not found" error
- Verify the UUID is correct and exists in the database
- Use the SQL query above to find the correct ID

### Function doesn't exist
- The SQL migration hasn't been applied yet
- Apply `phase24_recalculate_scores_function.sql` to your database

### Unexpected score changes
- Run the preview query above to see what changed
- Check that question IDs and answer formats match expectations
- Review the original student answers in `attempts.answers_json`

## Related

- [Question Set Management](./QUESTION_SETS.md)
- [Test Instance Management](./TEST_INSTANCES.md)
- [Audit Logging](./AUDIT_LOGS.md)
