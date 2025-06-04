# resonite-issue-notify

GitHubの指定リポジトリの新しいIssueやコメントを定期的にチェックし、DiscordのWebhookで通知するBotです。

## 必要要件

- Node.js 18以上
- Discord Webhook URL
- GitHubアクセストークン（パブリックリポジトリのみ監視なら未設定でも可。ただしAPIレート制限あり）

## インストール

```bash
git clone https://github.com/yourname/resonite-issue-notify.git
cd resonite-issue-notify
npm install
```

## 設定

`.env`ファイルを作成し、以下の内容を記入してください（`.env_sample`も参考にできます）。

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
GITHUB_TOKEN=your_github_token_here
CHECK_INTERVAL=300000
REPOSITORIES=microsoft/vscode,facebook/react,vercel/next.js
```

- **DISCORD_WEBHOOK_URL**: 通知を送信するDiscordのWebhook URL
- **GITHUB_TOKEN**: GitHubのPersonal Access Token（未設定の場合はAPIレート制限が厳しくなります）
- **CHECK_INTERVAL**: チェック間隔（ミリ秒、デフォルト5分）
- **REPOSITORIES**: 監視したいリポジトリをカンマ区切りで指定（例: `owner1/repo1,owner2/repo2`）

## 使い方

```bash
# 通常起動
node main.mjs

# 開発用（自動再起動）
npx nodemon main.mjs
```

Botを起動すると、指定したリポジトリの新しいIssueやコメントがDiscordに通知されます。

## ライセンス

MIT
