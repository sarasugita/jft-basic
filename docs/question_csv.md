# Question CSV Format

Admin UI の `Import Questions` で利用する CSV 形式です。

## 必須カラム
- `test_version` (空の場合はフォームの `test_version` を使用)
- `question_id`
- `section_key` (SV/CE/LC/RC)
- `type`

## 推奨/任意カラム
- `order_index`
- `prompt_en`
- `prompt_bn`
- `answer_index` (トップレベル用)
- `sentence_ja` (mcq_sentence_blank)
- `sentence_parts_json` (mcq_kanji_reading: JSON配列)
- `dialog_ja` (mcq_dialog_with_image: `|` 区切り or JSON配列)
- `blank_style`
- `image`
- `audio`
- `stem_image`
- `passage_image`
- `table_image`

## 選択肢 (トップレベル)
**推奨: 別カラム**  
- `choice1_ja` ... `choice6_ja`
- `choice1_image` ... `choice6_image`

※ 互換用に `choices_ja` / `choice_images` の `|` 区切りも読み取れますが、
新規作成では **別カラム推奨** です。

## パート付き (最大2パート)
各パートは以下のカラムを使用します。

共通:
- `part1_label`
- `part1_question_ja`
- `part1_answer_index`
- `part2_label`
- `part2_question_ja`
- `part2_answer_index`

選択肢（別カラム推奨）:
- `part1_choice1_ja` ... `part1_choice6_ja`
- `part1_choice1_image` ... `part1_choice6_image`
- `part2_choice1_ja` ... `part2_choice6_ja`
- `part2_choice1_image` ... `part2_choice6_image`

※ 互換用に `part1_choices_ja` / `part1_choice_images` などの `|` 区切りも読み取れます。

## type別の必須情報
- `mcq_image`: `image`, `choices_ja`, `answer_index`
- `mcq_sentence_blank`: `sentence_ja`, `choices_ja`, `answer_index`
- `mcq_kanji_reading`: `sentence_parts_json`, `choices_ja`, `answer_index`
- `mcq_dialog_with_image`: `dialog_ja`, `image`, `choices_ja`, `answer_index`
- `mcq_illustrated_dialog`: `image`, `choices_ja`, `answer_index`
- `mcq_listening_image_choices`: `audio`, `stem_image`, `choice_images`, `answer_index`
- `mcq_listening_two_part_image`: `audio`, `stem_image`, `part1/part2`
- `mcq_reading_passage_two_questions`: `passage_image`, `part1/part2`
- `mcq_reading_table_two_questions`: `table_image`, `part1/part2`

## `sentence_parts_json` 例
```json
[
  { "text": "水道", "underline": true },
  { "text": "が　こわれた　ときは、ここに　でんわして　ください。" }
]
```

## 例
```csv
test_version,question_id,section_key,type,prompt_en,prompt_bn,image,choice1_ja,choice2_ja,choice3_ja,answer_index
test_exam,SV-1,SV,mcq_image,"Look at the illustration and choose the correct word.","...",q1.png,なきます,おこります,わらいます,2
```

テンプレート:
- `docs/question_csv_template.csv`（別カラム版）

画像/音声について:
- CSVには `q1.png` のような**ファイル名のみ**でもOK
- 先に `test-assets` にアップロードしておくと、取り込み時に自動でURLへ解決されます
