# CLAUDE.md

Claude Code がこのリポジトリで作業するときの指針です。

## まず `AGENTS.md` を読む

このリポジトリの作業前提・制約・確認手順・完了条件・報告フォーマットは
[AGENTS.md](AGENTS.md) に集約されています。**Claude Code も AGENTS.md の方針に従ってください。**
本ファイルは、その上で「実際の技術スタック」と「Agent Skills の使い方」を補足します。

> 注意: `AGENTS.md` は汎用テンプレート（React / Vite / Next.js などを TODO 形式で例示）です。
> このリポジトリの**実際の構成は下記が正**です。両者が食い違う場合は本ファイルの記述を優先してください。

## 実際の技術スタック（このリポジトリの正）

GeoSection は GPX から地図・断面図・傾斜図を生成する **GitHub Pages 向けの静的 Web アプリ**です。

- フロントエンド: **バニラ JavaScript / HTML / CSS**（`app.js`, `index.html`, `styles.css`）
  - **React / Next.js / TypeScript / Tailwind は使用していません。**
- ビルド/ツール: Node.js の自作スクリプト（ESM）
  - build: `node scripts/build.mjs` → 出力先 `dist/`
  - test: `node tests/run-tests.mjs`（+ `node --check app.js`）
  - lint: 自作 `node scripts/lint.mjs`
  - typecheck: `node --check`（構文チェック）
- GPX 前処理など: Python スクリプト群（`create_profile.py` ほか）と `.venv/`
- デプロイ: `.github/workflows/pages.yml` で `main` push 時に `dist/` を GitHub Pages へ

### コマンド

`package.json` の script を使います。PowerShell で `npm.ps1` が実行ポリシーで止まる場合は `npm.cmd` を使ってください。

```bash
npm.cmd test          # node --check app.js && node tests/run-tests.mjs
npm.cmd run lint      # node scripts/lint.mjs
npm.cmd run typecheck # node --check（各 .mjs / app.js の構文チェック）
npm.cmd run build     # dist/ を生成
```

存在しない script は実行しないでください。

## Agent Skills

このリポジトリは Vercel の `skills` CLI で配布 Skill を導入しています。

- 配置: `.claude/skills/<name>/SKILL.md`（Claude Code が読む場所。git 追跡対象）
- バージョン管理: `skills-lock.json`（git 追跡対象）
- `.agents/` は CLI が他エージェント向けに複製する冗長コピーで、`.gitignore` で除外しています。

### 導入済み Skill（いずれもフレームワーク非依存。バニラ JS/CSS で有効）

| Skill | 用途 |
| --- | --- |
| `web-design-guidelines` | UI / アクセシビリティ / UX のレビュー（Web Interface Guidelines 準拠チェック） |
| `make-interfaces-feel-better` | UI の磨き込み・マイクロインタラクション・アニメーション・余白/影/角丸/タイポgrafi |

### Skill の使い分け方針

- **UI 改善・デザイン調整時**: `web-design-guidelines` でガイドライン準拠を確認する。
- **アニメーション・マイクロインタラクション調整時**: `make-interfaces-feel-better` の
  interface polish / motion 指針に従う（このリポジトリにはモーションライブラリが無いため、
  Skill 内の「依存なし（CSS transition / `cubic-bezier`）」のフォールバックを使うこと）。
- **React コンポーネント実装時 / Next.js 実装時**: 該当する Skill は**未導入**です。
  現状はバニラ JS のため適用できません。将来 React / Next.js を導入する場合は、
  `npx skills add vercel-labs/agent-skills` から
  `vercel-react-best-practices` / `vercel-composition-patterns` /
  `vercel-react-view-transitions` を追加して使ってください（本ファイルも更新すること）。

### Skill 適用時の優先順位（重要）

- **変更前に、必ず既存コード（`app.js` / `styles.css` / `index.html`）の慣習を確認する。**
- **Skill の内容と既存リポジトリの規約・既存デザインが衝突する場合は、既存リポジトリの規約を優先する。**
  - 例: Skill は Tailwind クラスや framer-motion を前提にした記述があるが、このリポジトリは
    プレーン CSS のため、概念だけを取り入れ、実装はプレーン CSS / バニラ JS に翻訳する。
- AGENTS.md の「不要なアニメーションを避ける／既存デザイン方針を優先」とも整合させる。

### 変更後の検証（最小範囲）

変更後は、関係する範囲で可能な限り以下を実行する（存在しないものは実行不要）。

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build   # 必要に応じて
```

詳細な検証・報告フォーマットは [AGENTS.md](AGENTS.md) の「Testing and Verification」「Final Response Format」に従う。

### Skill の更新方法

```bash
npx skills list                 # 導入済み一覧
npx skills update               # skills-lock.json に基づき最新へ更新
npx skills experimental_install # skills-lock.json から復元（クローン直後など）
```

新しい Skill を導入する前に、必ず中身（SKILL.md と参照 .md）を確認し、
`curl` / `wget` / `rm -rf` / `TOKEN` / `SECRET` / 外部送信 / 権限昇格 / 認証情報読み取り等の
不審な記述が無いことをレビューしてください。
