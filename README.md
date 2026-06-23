# GeoSection

GPX ファイルから地図上のルート、断面図、傾斜図を生成する GitHub Pages 向けの静的 Web アプリです。GPX に標高が入っていない点がある場合は、緯度経度を公開標高 API に送って標高を補完し、補完済み GPX をダウンロードできます。

**公開リンク: <https://ry32767.github.io/GeoSection/>**

## 使い方

1. 公開リンク <https://ry32767.github.io/GeoSection/> を開きます。
2. 登録済み GPX ボタンを押すか、手元の `.gpx` ファイルを選択します。
3. 標高が無い点がある場合は、標高 API により補完されます。
4. 地図、断面図、傾斜図を確認します。
5. 必要に応じて「補完済み GPX を保存」から `.gpx` を保存します。
6. 「印刷・エクスポート」で A4 / A3 などの用紙比率と縦強調を調整し、断面図または傾斜図を PNG で保存します。

既定の標高 API は `https://api.open-elevation.com/api/v1/lookup` です。混雑や制限で失敗する場合は、同じ応答形式の互換 API URL に変更してください。

## ローカル検証

PowerShell で `npm.ps1` が実行ポリシーにより止まる場合は `npm.cmd` を使います。

```bash
npm.cmd test
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

ビルド成果物は `dist/` に生成されます。

## GitHub Pages

`.github/workflows/pages.yml` により、`main` ブランチへの push または手動実行で `dist/` が `gh-pages` ブランチへデプロイされ、<https://ry32767.github.io/GeoSection/> で公開されます。
