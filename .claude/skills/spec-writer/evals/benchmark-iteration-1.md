# Skill Benchmark: spec-writer

**Model**: <model-name>
**Date**: 2026-06-24T10:00:38Z
**Evals**: 1, 2, 3 (3 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 97% ± 7% | +0.03 |
| Time | 0.0s ± 0.0s | 0.0s ± 0.0s | +0.0s |
| Tokens | 0 ± 0 | 0 ± 0 | +0 |

## Notes

- Overall assertion pass rate — with_skill 100% ± 0% vs baseline 97% ± 7% (delta +0.03).
- Blind A/B (judge not told which is which): with_skill won 1, baseline won 2, ties 0.
-     - kml-import: blind winner=with_skill (with_skill 8.7 vs baseline 8.3)
-     - multiday-merge: blind winner=without_skill (with_skill 8.0 vs baseline 9.0)
-     - expense-ocr-bot: blind winner=without_skill (with_skill 8.0 vs baseline 9.0)
- Assertions the skill most improves over baseline:
-     - [+50 pts] 日付/ファイルの並び順の決定方法と、タイムスタンプ欠如など順序が決まらないケースのエッジケースを扱う
- Non-discriminating assertions (same pass rate both configs — may not test skill value):
-     - [100%==100%] 現状（GPX のみ対応）に触れ、KML 追加後も GPX の既存挙動を壊さないという制約を明示している
-     - [100%==100%] app.js / index.html など実在するファイル・コンポーネント単位で、何を追加・変更するかを具体的に示して…
-     - [100%==100%] KML をパースして GPX と共通の内部データ構造（ルート点・標高など）へ正規化する方針を設計している
-     - [100%==100%] 標高が無い KML・座標のみ・不正な拡張子など、入力の欠損／異常系のエッジケースとその扱いを挙げている
-     - [100%==100%] 「正しく動く」ではなく観測可能な振る舞いで書かれた、検証可能な受け入れ基準（テスト観点）を含む
-     - [100%==100%] リクエストの言い換えに留まらず、具体的な設計判断（データ構造・処理フロー・関数分割など）を加えている
-     - [100%==100%] 複数 GPX 連結時の距離の通し積算と、各日の境界（区切り／色分け）をどうデータに持たせるかを設計している
-     - [100%==100%] 既存の単一 GPX 表示・地図と断面図の同期挙動を壊さない方針に触れている
-     - [100%==100%] 影響を受ける実在のコンポーネント（断面図描画・データ読み込み等）をファイル/関数粒度で示している
-     - [100%==100%] 「3本連結で距離が単調増加し境界が描画される」のような検証可能な受け入れ基準を含む
-     - [100%==100%] レビュー可能な小さい単位に割った、順序付きの実装ステップを提示している
-     - [100%==100%] 現状（全て手入力）と新フロー（画像→OCR→フォーム下書き）の差分・スコープ（goals/non-goals）を明確化し…
-     - [100%==100%] OCR 抽出のデータモデル（金額／日付／店名 + 信頼度など）と、誤読時に人が確認・修正するフローを設計している
-     - [100%==100%] 外部 OCR サービスや Slack のファイル/メッセージ API など、コンポーネント間の連携インターフェースを具体…
-     - [100%==100%] 低解像度・多通貨・1枚に複数レシート・非レシート画像などのエッジケースとエラー処理を挙げている
-     - [100%==100%] 抽出精度や人手確認ステップなど、観測可能で検証可能な受け入れ基準を含む
-     - [100%==100%] PII の取り扱い・OCR コスト・誤申請リスクなど、未解決の論点／リスクに言及している