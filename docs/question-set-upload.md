# Global Question Set Upload

## Super Admin Page

Use `/super/tests/import` to manage the global question-set library.

Available actions:

- create a new question set
- validate CSV and assets before saving
- upload a new version of an existing question set
- edit metadata without changing existing questions
- switch visibility between `global` and `restricted`
- archive an old question set version

## Required CSV Columns

Each CSV row represents one question.

Required columns:

- `qid`
- `question_text`
- `question_type`
- `correct_answer`

Optional columns:

- `options`
- `media_file`
- `media_type`
- `order_index`
- `metadata`

## Column Rules

`qid`

- unique inside the uploaded CSV
- used as the stable question identifier for that question-set version

`options`

- either a JSON array like `["A","B","C"]`
- or pipe-separated text like `A|B|C`

`correct_answer`

- plain text is allowed
- JSON is also allowed for structured answers

`media_file`

- optional asset filename referenced by the CSV
- must match one of the uploaded asset filenames exactly

`media_type`

- optional
- allowed values: `image`, `audio`
- if omitted, the system tries to infer it from the asset file extension

`metadata`

- optional JSON object per question

## Asset Referencing

Upload image/audio files together with the CSV.

Supported asset types:

- images: `png`, `jpg`, `jpeg`, `webp`, `gif`, `svg`
- audio: `mp3`, `wav`, `m4a`, `ogg`

If a row references `media_file = listening1.mp3`, that exact file must be included in the upload.

Assets are stored in the `test-assets` bucket under:

- `question-sets/<library_key>/<version_label>/<filename>`

## Validation

The validation step blocks saving if:

- required columns are missing
- `qid` values are duplicated
- a referenced asset filename is missing from the upload
- JSON fields are malformed

Warnings may still appear for non-blocking issues, such as media type inference fallback.

## Versioning

Use `Upload New Version` from the library table to create a new version.

Behavior:

- the new version stays in the same library group
- previous versions remain in the database
- metadata is copied into the form and can be adjusted
- question content changes only when a new CSV/assets package is uploaded

## Visibility

`global`

- assignable to all schools

`restricted`

- assignable only to the schools selected in the visibility picker
- backend enforcement uses the question-set school access join table
