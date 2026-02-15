# Question CSV Format (Vertical)

Admin UI の `Upload & Create Exam` で利用する **縦型CSV** 形式です。
1行=1問。複数設問は `sub_id` を変えて行を増やします（parts合成はしません）。

## 固定カラム（順不同でOK）
```
test_version,qid,sub_id,item_id,section_key,type,order_index,prompt_en,prompt_bn,
stem_kind,stem_text,stem_asset,stem_extra,box_text,
choiceA,choiceB,choiceC,choiceD,answer,target,meta_blank_style
```

- `N/A` は空扱い（UIに表示しない）
- `answer` は `A|B|C|D`
- `choices` は `choiceA..D` のうち `N/A` を除外して配列化

## 主要カラムの意味
- `test_version`: テスト識別子（必須）
- `item_id`: 1問のユニークID（必須）
- `qid`: まとまりID（同一設問グループなど、任意）
- `sub_id`: グループ内の連番（任意）
- `section_key`: `SV|CE|LC|RC`
- `type`: 問題タイプ（表示の参考）
- `order_index`: 表示順（数値）
- `prompt_en/prompt_bn`: 英語/ベンガル語

### stem 系
- `stem_kind`: `text|image|audio|passage_image|table_image|dialog` など
- `stem_text`: 本文（`【...】` で下線）
- `stem_asset`: 画像/音声ファイル名（例: `q1.png`, `lc1.mp3`）
- `stem_extra`: 追加本文（複数行は `|` 区切り）
- `box_text`: 枠付き表示の設問文（あれば）

### choices / answer
- `choiceA..D`: 選択肢（画像選択肢なら `lc1_a.png` のようにファイル名でOK）
- `answer`: `A|B|C|D`

## 下線表現
- `【水道】が…` のように `【】` で囲んだ部分を下線表示します。

## 例
```csv
test_version,qid,sub_id,item_id,section_key,type,order_index,prompt_en,prompt_bn,stem_kind,stem_text,stem_asset,stem_extra,box_text,choiceA,choiceB,choiceC,choiceD,answer,target,meta_blank_style
test_exam,SV-1,N/A,SV-1,SV,mcq_image,1,Look at the illustration and choose the correct word.,...,image,N/A,q1.png,N/A,N/A,なきます,おこります,わらいます,N/A,C,N/A,N/A
```

## 注意
- 旧仕様（part1/part2 や sentence_parts_json など）は **不要** です。
- ファイル名は **パスなし** で記載してください。
- `/images/...` や `/audio/...` のようなパスは無効です。

テンプレート:
- `docs/question_csv_template.csv`
- Admin UIからダウンロード: `/question_csv_template.csv`
