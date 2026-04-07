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

Each CSV row represents one question or one sub-question.

Headers used:

- `set_id`
- `qid`
- `sub_section`
- `prompt_en`
- `prompt_bn`
- `stem_kind`
- `stem_text`
- `stem_image`
- `stem_audio`
- `sub_question`
- `option_type`
- `correct_option`
- `wrong_option_1`
- `wrong_option_2`
- `wrong_option_3`

## Column Rules

`set_id`

- required for new uploads
- used as the Question Set SetID
- if one CSV contains multiple `set_id` values, the upload creates one question set per distinct `set_id`

`qid`

- unique inside the uploaded CSV
- values like `SV-1-1` are treated as sub-questions
- the base group becomes `SV-1` and the last number becomes the sub-question number

`sub_section`

- used as the section/category label in results and detailed results
- broad section behavior still follows the `qid` prefix such as `SV`, `CE`, `LC`, `RC`

`prompt_en` / `prompt_bn`

- shared prompt text for the question group
- if multiple rows share the same base `qid`, the prompt is shown once in the student test when the prompt values match

`stem_kind`

- supported values include `image`, `audio`, `audio_image`, `image_audio`, `dialog`, `passage_image`, `table_image`, `text_box`
- `text_box` renders empty `【】` markers as red answer boxes
- for `text_box`, lines that start with `A：...` or `B：...` wrap with a hanging indent aligned after `：`

`stem_text`

- supports underline markup using `【...】`
- with `stem_kind = text_box`, empty `【】` becomes a red input-style box

`stem_image` / `stem_audio`

- optional asset filenames referenced by the CSV
- each referenced asset must match one of the uploaded filenames exactly

`sub_question`

- optional per-sub-question prompt/body
- mapped into the grouped question display under the shared prompt

`correct_option` and `wrong_option_1..3`

- define the answer choices
- preview/import keeps this order
- student test delivery shuffles choice order while still storing the canonical answer correctly

## Asset Referencing

Upload image/audio files together with the CSV.

Supported asset types:

- images: `png`, `jpg`, `jpeg`, `webp`, `gif`, `svg`
- audio: `mp3`, `wav`, `m4a`, `ogg`

If a row references `stem_image = q1.png` or `stem_audio = lc3.mp3`, that exact file must be included in the upload.

Assets are stored in the `test-assets` bucket under:

- `question-sets/<library_key>/<version_label>/<filename>`

## Validation

The validation step blocks saving if:

- required columns are missing
- `qid` values are duplicated
- a referenced asset filename is missing from the upload
- duplicate `qid` values are uploaded

Warnings may still appear for non-blocking issues.

## Versioning

Use `Upload New Version` from the library table to create a new version.

Behavior:

- the new version stays in the same library group
- previous versions remain in the database
- metadata is copied into the form and can be adjusted
- the table shows `Ver.` as `v1`, `v2`, and so on
- question content changes only when a new CSV/assets package is uploaded

Visibility rules:

- a family that started as `global` stays `global` for later versions
- a family that started as `restricted` can be promoted to `global`
- when a restricted family is promoted, the new version becomes available to all schools

## Visibility

`global`

- assignable to all schools

`restricted`

- assignable only to the schools selected in the visibility picker
- backend enforcement uses the question-set school access join table

## Delete

Delete now removes the entire `SetID` family permanently.

Behavior:

- all versions under the same library group are deleted
- the `SetID` becomes reusable for future uploads
- if a family is still referenced by historical test instances or attempts, the delete is blocked to preserve history
