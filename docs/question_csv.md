# Question CSV Format

Admin UI の `Upload & Register Set` で利用する Model Test CSV 形式です。
1 行 = 1 問。`SV-1-1` のような `qid` は sub question として扱います。

## Headers

```csv
set_id,qid,sub_section,prompt_en,prompt_bn,stem_kind,stem_text,stem_image,stem_audio,sub_question,option_type,correct_option,wrong_option_1,wrong_option_2,wrong_option_3
```

- `set_id` は自動入力補助に使えますが、問題変換では必須ではありません
- 上記以外の header は無視されます
- ファイル名はパスなしで記載してください

## Column Notes

- `qid`
  - 例: `SV-1`, `SV-1-1`, `LC-3-2`
  - `SV-1-1` のような値では最後の数字を sub question 番号として扱います
  - 同じ親 `qid` を持つ sub question 群は student 画面で 1 グループとして表示されます

- `sub_section`
  - 結果画面、詳細結果、分析で表示するカテゴリ名です
  - broad section の動作は `qid` prefix (`SV`, `CE`, `LC`, `RC`) を使います

- `prompt_en` / `prompt_bn`
  - グループ共通の prompt です
  - 同じ親 `qid` の行で同じ prompt を使うと student 画面では 1 回だけ表示されます

- `stem_text`
  - `【水道】` のように `【】` で囲んだ語は下線表示されます

- `stem_image` / `stem_audio`
  - 画像や音声のファイル名です
  - upload した asset 名と完全一致している必要があります

- `sub_question`
  - sub question ごとの本文です
  - grouped question では各 sub question の表示に使われます

- `correct_option`, `wrong_option_1`, `wrong_option_2`, `wrong_option_3`
  - 選択肢です
  - preview ではこの並びを維持します
  - student 受験時は choice order を shuffle します

## Example

```csv
set_id,qid,sub_section,prompt_en,prompt_bn,stem_kind,stem_text,stem_image,stem_audio,sub_question,option_type,correct_option,wrong_option_1,wrong_option_2,wrong_option_3
test_exam,SV-1,Word meaning,Look at the illustration and choose the correct word.,,image,,q1.png,,,text,わらいます,なきます,おこります,
test_exam,LC-3-1,Comprehending content (listening to announcements and instructions),You will hear an officer talking about what to do in case of fire at an emergency drill at work.,,audio,,lc3_officer.png,lc3.mp3,火事が　おきたら、まず　何を　しますか。,image,lc3_1a.png,lc3_1b.png,lc3_1c.png,
test_exam,LC-3-2,Comprehending content (listening to announcements and instructions),You will hear an officer talking about what to do in case of fire at an emergency drill at work.,,audio,,lc3_officer.png,lc3.mp3,どこに　ひなん　しますか。,image,lc3_2b.png,lc3_2a.png,lc3_2c.png,
```

テンプレート:
- `docs/question_csv_template.csv`
- Admin UI からダウンロード: `/question_csv_template.csv`
