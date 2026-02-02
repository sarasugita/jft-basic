// src/data/questions.js

export const sections = [
  { key: "SV", title: "Script and Vocabulary", timeSec: 5 * 60 },
  { key: "CE", title: "Conversation and Expression", timeSec: 5 * 60 },
  { key: "LC", title: "Listening Comprehension", timeSec: 5 * 60 },
  { key: "RC", title: "Reading Comprehension", timeSec: 5 * 60 },
];

// 問題文（英語）だけ、Banglaに切り替えるための翻訳を持たせる
// choices は日本語だけにする（要望どおり）
export const questions = [
  // =========================
  // SV (4)
  // =========================

  // SV-1: イラスト + 語彙選択
  {
    id: "SV-1",
    sectionKey: "SV",
    type: "mcq_image",
    promptEn: "Look at the illustration and choose the correct word.",
    promptBn: "ছবিটি দেখে সঠিক শব্দটি নির্বাচন করুন।",
    image: "/src/assets/q1.png",
    choicesJa: ["なきます", "おこります", "わらいます"],
    answerIndex: 2,
  },

  // SV-2: 文（  ）穴埋め
  {
    id: "SV-2",
    sectionKey: "SV",
    type: "mcq_sentence_blank",
    promptEn: "Read the sentence and choose the word that fits in (   ) the most.",
    promptBn: "বাক্যটি পড়ে (   ) স্থানে সবচেয়ে উপযুক্ত শব্দটি নির্বাচন করুন।",
    sentenceJa: "だんだん　日本の　しゅうかんに　（　　）きました。",
    choicesJa: ["なれて", "ふえて", "すすんで"],
    answerIndex: 0,
  },

  // SV-3: 下線の漢字 → ひらがな
  {
    id: "SV-3",
    sectionKey: "SV",
    type: "mcq_kanji_reading",
    promptEn: "How do you write the underlined kanji word in hiragana? Choose the correct one.",
    promptBn: "আন্ডারলাইন করা কানজিটি হিরাগানায় কীভাবে লিখবেন? সঠিকটি নির্বাচন করুন।",
    sentencePartsJa: [
      { text: "水道", underline: true },
      { text: "が　こわれた　ときは、ここに　でんわして　ください。" },
    ],
    choicesJa: ["すいとう", "すいどう", "ずいどう"],
    answerIndex: 1,
  },

  // SV-4: 漢字語彙穴埋め
  {
    id: "SV-4",
    sectionKey: "SV",
    type: "mcq_sentence_blank",
    promptEn: "Read the sentence and choose the kanji word that fits in (   ) the most.",
    promptBn: "বাক্যটি পড়ে (   ) স্থানে সবচেয়ে উপযুক্ত কানজি শব্দটি নির্বাচন করুন।",
    sentenceJa: "とうきょうタワーが　よる　あかるく（　　）いて、とても　きれいでした。",
    choicesJa: ["乗って", "光って", "通って"],
    answerIndex: 1,
  },

  // =========================
  // CE (2)
  // =========================

  // CE-1: 会話文 + 右に画像（贈り物）
  {
    id: "CE-1",
    sectionKey: "CE",
    type: "mcq_dialog_with_image",
    promptEn:
      "Mei-san is asking Emi-san about baby gifts. Read the dialog and choose the phrase that fits the most.",
    promptBn:
      "মেই-সান এমি-সানকে শিশু উপহার সম্পর্কে জিজ্ঞেস করছেন। সংলাপটি পড়ে সবচেয়ে উপযুক্ত বাক্যাংশটি নির্বাচন করুন।",
    dialogJa: [
      "メイ： えみさん、ちょっと　聞いても　いいですか。",
      "えみ： 何ですか。",
      "メイ： 会社の　せんぱいに　お子さんが　生まれたので、",
      "　　　お祝いに　何か［　　］と　思うんですが、",
      "　　　いくらぐらいの　ものが　いいですか。",
      "えみ： そうですね。会社の　人には　だいたい　５０００円ぐらいの　ものですね。",
    ],
    blankStyle: "redBox", // UI用
    image: "/src/assets/ce1_gift.png",
    choicesJa: ["あげない", "あげよう", "あげるため", "あげるつもり"],
    answerIndex: 1,
  },

  // CE-2: イラスト会話（吹き出し）+ 穴
  {
    id: "CE-2",
    sectionKey: "CE",
    type: "mcq_illustrated_dialog",
    promptEn:
      "Two people are talking during lunch break at work. Read the dialog and choose the expression that fits the most.",
    promptBn:
      "কর্মস্থলে লাঞ্চ ব্রেকের সময় দুজন কথা বলছে। সংলাপটি পড়ে সবচেয়ে উপযুক্ত অভিব্যক্তিটি নির্বাচন করুন।",
    image: "/src/assets/ce2_dialog.png",
    choicesJa: ["こちらこそ", "もう　いちど", "また　こんど"],
    answerIndex: 2,
  },

  // =========================
  // LC (3)
  // =========================

  // LC-1: 音声 + 画像3択
  {
    id: "LC-1",
    sectionKey: "LC",
    type: "mcq_listening_image_choices",
    promptEn:
      "You will hear two people talking about the New Year holidays at work. What did the man do with his friend during the New Year holidays?",
    promptBn:
      "আপনি কর্মস্থলে নববর্ষের ছুটি নিয়ে দুজনের কথা শুনবেন। পুরুষটি বন্ধুর সাথে নববর্ষের ছুটিতে কী করেছে?",
    audio: "/audio/lc1.mp3",
    stemImage: "/src/assets/lc1_people.png",
    choiceImages: [
      "/src/assets/lc1_a.png",
      "/src/assets/lc1_b.png",
      "/src/assets/lc1_c.png",
    ],
    answerIndex: 0,
  },

  // LC-2: 音声 + 画像3択（おにぎり/パン/カップ麺みたいな）
  {
    id: "LC-2",
    sectionKey: "LC",
    type: "mcq_listening_image_choices",
    promptEn:
      "You will hear a man asking a store staff about products at the convenience store. Which one can the man eat/drink?",
    promptBn:
      "আপনি কনভিনিয়েন্স স্টোরে একজন পুরুষকে দোকানের স্টাফকে পণ্যের বিষয়ে জিজ্ঞেস করতে শুনবেন। কোনটি সে খেতে/পান করতে পারে?",
    audio: "/audio/lc2.mp3",
    stemImage: "/src/assets/lc2_store.png",
    choiceImages: [
      "/src/assets/lc2_a.png",
      "/src/assets/lc2_b.png",
      "/src/assets/lc2_c.png",
    ],
    answerIndex: 2,
  },

  // LC-3: 1つの音声で(1)(2)の2問（各3択画像）
  {
    id: "LC-3",
    sectionKey: "LC",
    type: "mcq_listening_two_part_image",
    promptEn:
      "You will hear an officer talking about what to do in case of fire at an emergency drill at work.",
    promptBn:
      "আপনি কর্মস্থলের জরুরি ফায়ার ড্রিল সম্পর্কে একজন কর্মকর্তার কথা শুনবেন।",
    audio: "/audio/lc3.mp3",
    stemImage: "/src/assets/lc3_officer.png",
    parts: [
      {
        partLabel: "(1)",
        questionJa: "火事が　おきたら、まず　何を　しますか。",
        choiceImages: [
          "/src/assets/lc3_1a.png",
          "/src/assets/lc3_1b.png",
          "/src/assets/lc3_1c.png",
        ],
        answerIndex: 0,
      },
      {
        partLabel: "(2)",
        questionJa: "どこに　ひなん　しますか。",
        choiceImages: [
          "/src/assets/lc3_2a.png",
          "/src/assets/lc3_2b.png",
          "/src/assets/lc3_2c.png",
        ],
        answerIndex: 1,
      },
    ],
  },

  // =========================
  // RC (2)
  // =========================

  // RC-1: 長文 + (1)(2) それぞれ選択肢（テキスト）
  {
    id: "RC-1",
    sectionKey: "RC",
    type: "mcq_reading_passage_two_questions",
    promptEn:
      "You are reading a town's public information magazine. Answer questions (1) and (2).",
    promptBn:
      "আপনি একটি শহরের জনতথ্য ম্যাগাজিন পড়ছেন। (1) এবং (2) প্রশ্নের উত্তর দিন।",
    passageImage: "/src/assets/rc1_passage.png", // 文章を画像で持つならこれ
    parts: [
      {
        partLabel: "(1)",
        questionJa: "フェスティバルに　行った　人は　何が　できましたか。",
        choicesJa: ["歌と　おどりを　見ること", "がっきを　買うこと", "アクセサリーを　作ること"],
        answerIndex: 0,
      },
      {
        partLabel: "(2)",
        questionJa: "ホアさんは　スピーチコンテストに　参加して　どう　思いましたか。",
        choicesJa: [
          "スピーチの　けいけんが　なかったけど、うまく　いった",
          "自分の　スピーチを　わらわれて、かなしかった",
          "日本人の　英語の　スピーチが　上手で、びっくりした",
        ],
        answerIndex: 0,
      },
    ],
  },

  // RC-2: 表（薬の説明）画像 + (1)(2)
  {
    id: "RC-2",
    sectionKey: "RC",
    type: "mcq_reading_table_two_questions",
    promptEn:
      "Kumaru-san received instructions on medicines at the pharmacy. Read the instructions and answer questions (1) and (2).",
    promptBn:
      "কুমারু-সান ফার্মেসিতে ওষুধের নির্দেশনা পেয়েছেন। নির্দেশনা পড়ে (1) ও (2) প্রশ্নের উত্তর দিন।",
    tableImage: "/src/assets/rc2_table.png",
    parts: [
      {
        partLabel: "(1)",
        questionJa: "セキドミカプセルは　１回に　いくつ　飲みますか。",
        choicesJa: ["２つ", "３つ", "５つ"],
        answerIndex: 0,
      },
      {
        partLabel: "(2)",
        questionJa: "飲んだ　後、ねむくなるかもしれないのは　どれですか。",
        choicesJa: ["ネツナレ錠", "セキドミカプセル", "タントレン錠"],
        answerIndex: 1,
      },
    ],
  },
];
