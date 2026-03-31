# CSV Import Limit Analysis - Free Supabase Plan

## Problem
When importing CSV files with many columns (many test sessions for daily/model tests, or many students for attendance), the import fails with empty columns/rows errors.

## Root Causes Identified

### 1. **Attendance Import - NO BATCHING** ⚠️ CRITICAL
**File:** `AdminConsoleCore.jsx` lines 10092-10094

**Issue:** All attendance entries for a single day are inserted in ONE request without batching:
```javascript
const { error: insertError } = await supabase
  .from("attendance_entries")
  .upsert(insertRows, { onConflict: "day_id,student_id" });
```

- If importing attendance for 1 day with 200+ students = 200+ rows in single request
- Free Supabase has HTTP request size limits (~2MB)
- Large JSON payload hits request size limit → insert fails

### 2. **Test Results Import - Has Batching (Good)**
**File:** `AdminConsoleCore.jsx` lines 949-950, 9902-9907

**Good Practice:** Batches inserts in chunks of 250 (configurable):
```javascript
const IMPORTED_ATTEMPT_BATCH_SIZE = 250;
// ...
for (const payloadChunk of chunkItems(payloads, IMPORTED_ATTEMPT_BATCH_SIZE)) {
  const insertError = await insertImportedAttemptPayloadChunk(payloadChunk);
```

## Free Supabase Limits
- **HTTP Request Size:** ~2MB total
- **Max Rows Per Insert:** Unlimited, but constrained by request size
- **Row Size:** ~400KB per row (depends on JSONB content)
- **Connection Timeout:** ~30s

## Solution
Add batching to attendance_entries insertion, similar to how test results are batched.

**Recommended batch size:** 250 entries per request (same as test results)

## Symptoms Users See
1. Import "completes" but shows empty columns/rows in table
2. No visible error message (or generic error)
3. Partial data imports
4. Request timeout
5. Database constraint violations from partial inserts

## Files to Fix
1. `AdminConsoleCore.jsx` - `importAttendanceGoogleSheetsCsv()` function (line 9911)
   - Add attendance batching logic
   - Define `ATTENDANCE_IMPORT_BATCH_SIZE = 250`
