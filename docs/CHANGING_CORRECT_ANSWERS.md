# Changing Correct Answers - Location & Implementation Guide

## Current Preview Location

The preview of questions with highlighted correct answers appears in two places:

### 1. **Results Workspace - Question Preview**
- **File**: `apps/admin/src/components/AdminConsoleResultsWorkspace.jsx`
- **Component**: `QuestionPreviewCard` (line 1323)
- **Function**: `renderPreviewQuestionCard` (line 1450)
- **Modal**: Opens when viewing test results
- **Shows**: Questions with green-highlighted correct answers
- **Location in UI**: Click any test session → "Questions" tab → see all questions with correct answers marked

### 2. **Testing Workspace - Test Preview**  
- **File**: `apps/admin/src/components/AdminConsoleDeferredFeatures.jsx`
- **Component**: Uses same `QuestionPreviewCard` component
- **Modal**: Opens when previewing a test before publishing
- **Shows**: All questions with current correct answers marked green
- **Location in UI**: Testing tab → Model Tests or Daily Tests → "Preview" button on any test

## Current Answer Structure

### For New Question Sets (Phase 4+)
**Table**: `question_set_questions`
- **Column**: `correct_answer` (JSONB)
- **Value**: Stores the index number: `"0"`, `"1"`, `"2"`, etc.
- **Database Location**: Direct database → `public.question_set_questions`

### For Legacy Questions
**Table**: `questions`  
- **Column**: `answer_index` (integer)
- **Value**: Index number `0`, `1`, `2`, etc.
- **Database Location**: Direct database → `public.questions`

## How Answers Are Currently Displayed

In `QuestionPreviewCard` component (line 1348):
```javascript
const isCorrect = question.answerIndex === choiceIndex;
```

The `answerIndex` is compared against each choice's index to highlight the correct one.

## How to Implement "Change Answer" Button

### Step 1: Add Button to Choice Grid

Modify the `renderChoices()` function in `QuestionPreviewCard` to make choices clickable:

```javascript
const renderChoices = (isEditMode) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
    {choices.map((choice, choiceIndex) => {
      const isCorrect = question.answerIndex === choiceIndex;
      const isImage = isImageAsset(choice);
      return (
        <button
          key={`choice-${question.id}-${choiceIndex}`}
          onClick={() => isEditMode && onAnswerChange?.(question.id, choiceIndex)}
          className="btn"
          style={{
            border: isCorrect ? "2px solid #1a7f37" : "1px solid #ddd",
            background: isCorrect ? "#e7f7ee" : "#fff",
            padding: 8,
            cursor: isEditMode ? "pointer" : "default",
            opacity: isEditMode ? 1 : 0.8,
          }}
        >
          {isImage ? (
            <img src={choice} alt="choice" style={{ maxWidth: "100%" }} />
          ) : (
            choice
          )}
        </button>
      );
    })}
  </div>
);
```

### Step 2: Add Edit Mode Toggle & Checkboxes

```javascript
// At the top of QuestionPreviewCard component
const [isEditMode, setIsEditMode] = useState(false);
const [selectedQuestions, setSelectedQuestions] = useState(new Set());

const isSelected = selectedQuestions.has(question.id);

// In the render section (around line 1373)
<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    {isEditMode && (
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => {
          const newSet = new Set(selectedQuestions);
          if (e.target.checked) {
            newSet.add(question.id);
          } else {
            newSet.delete(question.id);
          }
          setSelectedQuestions(newSet);
        }}
        style={{ width: 20, height: 20, cursor: "pointer" }}
      />
    )}
    <div style={{ fontWeight: 700 }}>
      {displayQuestionId} {sectionLabel ? `(${sectionLabel})` : ""} {index != null ? `#${index + 1}` : ""}
    </div>
  </div>
  {children ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div> : null}
</div>
```

### Step 3: Database Update Function

Create a new function to update answers in the database:

```javascript
async function updateQuestionAnswers(updates) {
  // updates = [{ questionId: "...", newAnswerIndex: 2 }, ...]
  
  const { error } = await supabase
    .from('question_set_questions')
    .upsert(
      updates.map(({ questionId, newAnswerIndex }) => ({
        id: questionId,
        correct_answer: newAnswerIndex,
        updated_at: new Date().toISOString(),
      }))
    );

  if (error) {
    setMsg(`Error updating answers: ${error.message}`);
    return false;
  }

  setMsg(`Updated ${updates.length} answers`);
  return true;
}
```

### Step 4: Add "Change Answers" Button to Modal Header

In the preview modal header (AdminConsoleDeferredFeatures.jsx around line 656):

```javascript
<div className="admin-modal-header daily-session-create-header">
  <div className="admin-title">
    {previewSession ? previewSession.title || previewSession.problem_set_id : previewTest || "Preview"}
  </div>
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    {isEditMode && (
      <button className="btn btn-warning" onClick={saveChangedAnswers}>
        Save Changes ({changedAnswers.length})
      </button>
    )}
    <button 
      className={`btn ${isEditMode ? "btn-secondary" : "btn-primary"}`}
      onClick={() => setIsEditMode(!isEditMode)}
    >
      {isEditMode ? "Cancel" : "Change Answers"}
    </button>
    <button
      className="admin-modal-close"
      onClick={closePreview}
      aria-label="Close"
    >
      ×
    </button>
  </div>
</div>
```

## Implementation Steps (Summary)

1. **Modify QuestionPreviewCard component** in `AdminConsoleResultsWorkspace.jsx`
   - Add state for edit mode and selected questions
   - Add checkboxes next to each question
   - Make choices clickable when in edit mode
   - Show selected answer visually

2. **Update the preview modal** in `AdminConsoleDeferredFeatures.jsx`
   - Add "Change Answers" button to header
   - Show count of selected questions
   - Show "Save Changes" button when in edit mode

3. **Create database update function**
   - Update `question_set_questions.correct_answer` for selected questions
   - Handle batch updates efficiently
   - Show success/error messages

4. **Add audit logging** (optional)
   - Track who changed which answers
   - Show before/after values

5. **Update scores** (optional)
   - After changing answers, offer to recalculate scores
   - Use the `recalculate_question_set_scores()` function

## User Workflow

1. Admin opens test preview (click "Preview" button on any test)
2. Admin clicks "Change Answers" button
3. Questions get checkboxes
4. Admin clicks on wrong choices to select new correct answers
5. Admin checks checkbox next to questions they want to change
6. Admin clicks "Save Changes"
7. Answers are updated in database
8. Admin is offered option to "Recalculate Scores" immediately
9. Student scores are updated if they choose

## Regarding "so admin can do it too"

If you meant **both admin and super_admin can change answers** (instead of just super_admin):
- The `recalculate_question_set_scores()` function currently checks `current_user_role() = 'super_admin'`
- To allow regular admins, change the permission check in the SQL function
- Or create a separate function for admins with different permissions

**Let me know if this is what you meant!**

## Files to Modify

```
Priority: High
├── apps/admin/src/components/AdminConsoleResultsWorkspace.jsx
│   └── Modify QuestionPreviewCard component (line 1323)
├── apps/admin/src/components/AdminConsoleDeferredFeatures.jsx
│   └── Update preview modal header (line 656)
└── Add new utility function for database updates

Priority: Medium (Optional)
├── Add audit logging
└── Auto-trigger score recalculation
```
