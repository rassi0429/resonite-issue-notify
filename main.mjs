import 'dotenv/config';
import axios from 'axios';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GitHubDiscordBot {
    constructor() {
        this.discordWebhook = process.env.DISCORD_WEBHOOK_URL;
        this.githubToken = process.env.GITHUB_TOKEN;
        this.checkInterval = parseInt(process.env.CHECK_INTERVAL) || 300000; // 5分
        this.repositories = process.env.REPOSITORIES?.split(',') || [];
        this.lastCheckFile = join(__dirname, 'last_check.json');
        this.openaiApiKey = process.env.OPENAI_API_KEY;

        // Misskey関連
        this.misskeyInstance = process.env.MISSKEY_INSTANCE_URL;
        this.misskeyToken = process.env.MISSKEY_TOKEN;
        this.misskeyChannelId = process.env.MISSKEY_CHANNEL_ID;

        this.openai = this.openaiApiKey
            ? new OpenAI({ apiKey: this.openaiApiKey })
            : null;
        
        this.githubHeaders = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'GitHub-Discord-Bot'
        };
        
        if (this.githubToken) {
            this.githubHeaders['Authorization'] = `token ${this.githubToken}`;
        }
    }

    async translateToJapanese(text) {
        if (!this.openai) return null;
        if (!text) return null;
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4.1-mini",
                messages: [
                    { role: "system", content: "Translate the following text to Japanese. Output only the translation." },
                    { role: "user", content: text }
                ],
                max_tokens: 1000,
                temperature: 0.3
            });
            return completion.choices[0]?.message?.content?.trim() || null;
        } catch (e) {
            console.error('❌ OpenAI翻訳エラー:', e.message);
            return null;
        }
    }

    async getLastCheckTimes() {
        try {
            const data = await fs.readFile(this.lastCheckFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // ファイルが存在しない場合は1時間前を返す
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
            const defaultTimes = {};
            this.repositories.forEach(repo => {
                defaultTimes[repo] = {
                    issues: oneHourAgo,
                    comments: oneHourAgo
                };
            });
            return defaultTimes;
        }
    }

    async saveLastCheckTimes(times) {
        await fs.writeFile(this.lastCheckFile, JSON.stringify(times, null, 2));
    }

    async checkNewIssues(repo, since) {
        try {
            const response = await axios.get(`https://api.github.com/repos/${repo}/issues`, {
                headers: this.githubHeaders,
                params: {
                    since: since,
                    state: 'all',
                    sort: 'updated',
                    per_page: 50
                }
            });

            // プルリクエストを除外し、実際に新しく作成されたissueのみを返す
            return response.data.filter(issue => 
                !issue.pull_request && 
                new Date(issue.created_at) > new Date(since)
            );
        } catch (error) {
            console.error(`❌ Error fetching issues for ${repo}:`, error.message);
            return [];
        }
    }

    async checkNewComments(repo, since) {
        try {
            const response = await axios.get(`https://api.github.com/repos/${repo}/issues/comments`, {
                headers: this.githubHeaders,
                params: {
                    since: since,
                    per_page: 50
                }
            });

            return response.data.filter(comment => 
                new Date(comment.created_at) > new Date(since)
            );
        } catch (error) {
            console.error(`❌ Error fetching comments for ${repo}:`, error.message);
            return [];
        }
    }

    async sendDiscordNotification(embed) {
        try {
            await axios.post(this.discordWebhook, {
                embeds: [embed]
            });
            // Discord API制限対策で少し待機
            await this.sleep(200);
        } catch (error) {
            console.error('❌ Error sending Discord notification:', error.message);
        }
    }

    async sendMisskeyNotification(text, options = {}) {
        if (!this.misskeyInstance || !this.misskeyToken || !this.misskeyChannelId) {
            // Misskey設定がなければ何もしない
            return;
        }
        try {
            const payload = {
                i: this.misskeyToken,
                text,
                channelId: this.misskeyChannelId,
                ...options
            };
            await axios.post(`${this.misskeyInstance}/api/notes/create`, payload);
            // Misskey API制限対策で少し待機
            await this.sleep(200);
        } catch (error) {
            console.error('❌ Error sending Misskey notification:', error.message);
        }
    }

    createIssueEmbed(issue, repo) {
        const isOpen = issue.state === 'open';
        const color = isOpen ? 0x28a745 : 0x6c757d;
        const emoji = isOpen ? '🟢 OPENED' : '🔴 CLOSED';
        
        return {
            title: `${emoji}: ${this.truncateText(issue.title, 100)}`,
            description: issue.body ? this.truncateText(issue.body, 500) : '_No description provided_',
            url: issue.html_url,
            color: color,
            fields: [
                {
                    name: '📁 Repository',
                    value: `\`${repo}\``,
                    inline: true
                },
                {
                    name: '👤 Author',
                    value: `@${issue.user.login}`,
                    inline: true
                },
                {
                    name: '🏷️ Issue #',
                    value: `#${issue.number}`,
                    inline: true
                },
                {
                    name: '📅 Created',
                    value: `<t:${Math.floor(new Date(issue.created_at).getTime() / 1000)}:R>`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            thumbnail: {
                url: issue.user.avatar_url
            },
            footer: {
                text: `GitHub Issue • ${repo}`,
                icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
            }
        };
    }

    createCommentEmbed(comment, repo) {
        return {
            title: '💬 New Comment Added',
            description: this.truncateText(comment.body, 500),
            url: comment.html_url,
            color: 0x17a2b8,
            fields: [
                {
                    name: '📁 Repository',
                    value: `\`${repo}\``,
                    inline: true
                },
                {
                    name: '👤 Author',
                    value: `@${comment.user.login}`,
                    inline: true
                },
                {
                    name: '📅 Posted',
                    value: `<t:${Math.floor(new Date(comment.created_at).getTime() / 1000)}:R>`,
                    inline: false
                }
            ],
            timestamp: new Date().toISOString(),
            thumbnail: {
                url: comment.user.avatar_url
            },
            footer: {
                text: `GitHub Comment • ${repo}`,
                icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
            }
        };
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async checkRepository(repo, lastCheckTimes) {
        console.log(`🔍 Checking ${repo}...`);
        
        const repoTimes = lastCheckTimes[repo] || {
            issues: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            comments: new Date(Date.now() - 60 * 60 * 1000).toISOString()
        };

        let issueCount = 0;
        let commentCount = 0;

        try {
            // 新しいissueをチェック
            const newIssues = await this.checkNewIssues(repo, repoTimes.issues);
            for (const issue of newIssues) {
                const embed = this.createIssueEmbed(issue, repo);
                // 日本語翻訳を追加
                const jpTitle = await this.translateToJapanese(issue.title);
                const jpBody = issue.body ? await this.translateToJapanese(issue.body) : null;
                if (jpTitle || jpBody) {
                    embed.fields.push({
                        name: '🇯🇵 日本語タイトル',
                        value: jpTitle || '(翻訳不可)',
                        inline: false
                    });
                    if (jpBody) {
                        embed.fields.push({
                            name: '🇯🇵 日本語本文',
                            value: jpBody,
                            inline: false
                        });
                    }
                }
                await this.sendDiscordNotification(embed);

                // Misskey用テキスト組み立て
                let misskeyText = `【${issue.state === 'open' ? '🟢OPENED' : '🔴CLOSED'}】${jpTitle} \n ${issue.title} \n`;
                misskeyText += `[Issue #${issue.number}](${issue.html_url}) ＠${issue.user.login}\n`;
                if (issue.body) misskeyText += `\n\n\n ${jpBody} \n\n\n`;

                await this.sendMisskeyNotification(misskeyText);

                issueCount++;
                console.log(`📝 Issue notification sent: #${issue.number} - ${this.truncateText(issue.title, 50)}`);
            }

            // 新しいコメントをチェック
            const newComments = await this.checkNewComments(repo, repoTimes.comments);
            for (const comment of newComments) {
                const embed = this.createCommentEmbed(comment, repo);
                // 日本語翻訳を追加
                const jpBody = comment.body ? await this.translateToJapanese(comment.body) : null;
                if (jpBody) {
                    embed.fields.push({
                        name: '🇯🇵 日本語コメント',
                        value: jpBody,
                        inline: false
                    });
                }
                await this.sendDiscordNotification(embed);

                // コメントが紐づくissueのタイトルを取得
                let issueTitle = '';
                let jpIssueTitle = '';
                try {
                    const issueRes = await axios.get(comment.issue_url, { headers: this.githubHeaders });
                    issueTitle = issueRes.data.title || '';
                    jpIssueTitle = issueTitle ? await this.translateToJapanese(issueTitle) : '';
                } catch (e) {
                    issueTitle = '';
                    jpIssueTitle = '';
                }

                console.log(comment)
                // comment.html_urlからissue番号を抽出
                const issueNumber = (() => {
                    const m = comment.html_url.match(/\/issues\/(\d+)/);
                    return m ? m[1] : '';
                })();
                // Misskey用テキスト組み立て
                let misskeyText = `💬 New Comment  ${jpIssueTitle} \n [Issue #${issueNumber}](${comment.html_url}) ＠${comment.user.login} \n`;
                if (comment.body) misskeyText += `\n${jpBody}\n\n\n`;
                await this.sendMisskeyNotification(misskeyText);

                commentCount++;
                console.log(`💬 Comment notification sent from @${comment.user.login}`);
            }

            // 最終チェック時刻を更新
            const now = new Date().toISOString();
            lastCheckTimes[repo] = {
                issues: newIssues.length > 0 ? now : repoTimes.issues,
                comments: newComments.length > 0 ? now : repoTimes.comments
            };

            if (issueCount > 0 || commentCount > 0) {
                console.log(`✅ ${repo}: ${issueCount} issues, ${commentCount} comments sent`);
            } else {
                console.log(`✅ ${repo}: No new activity`);
            }

        } catch (error) {
            console.error(`❌ Error checking ${repo}:`, error.message);
        }

        // APIレート制限対策
        await this.sleep(1000);
    }

    async runCheck() {
        try {
            console.log(`\n🔄 Starting check cycle at ${new Date().toLocaleString()}`);
            const lastCheckTimes = await this.getLastCheckTimes();
            
            for (const repo of this.repositories) {
                const trimmedRepo = repo.trim();
                if (trimmedRepo) {
                    await this.checkRepository(trimmedRepo, lastCheckTimes);
                }
            }
            
            await this.saveLastCheckTimes(lastCheckTimes);
            console.log(`✅ Check cycle completed at ${new Date().toLocaleString()}`);
            
        } catch (error) {
            console.error('❌ Error during check cycle:', error.message);
        }
    }

    async start() {
        console.log('🚀 GitHub Discord Bot started!');
        console.log(`📊 Monitoring repositories: ${this.repositories.join(', ')}`);
        console.log(`⏰ Check interval: ${this.checkInterval / 1000} seconds`);
        console.log(`🔑 GitHub token: ${this.githubToken ? '✅ Configured' : '❌ Not configured (rate limited)'}`);
        console.log(`🎯 Discord webhook: ${this.discordWebhook ? '✅ Configured' : '❌ Not configured'}\n`);
        
        if (!this.discordWebhook) {
            console.error('❌ DISCORD_WEBHOOK_URL is required!');
            process.exit(1);
        }

        if (this.repositories.length === 0) {
            console.error('❌ No repositories specified in REPOSITORIES!');
            process.exit(1);
        }
        
        // 初回実行
        await this.runCheck();
        
        // 定期実行
        const intervalId = setInterval(async () => {
            await this.runCheck();
        }, this.checkInterval);

        // Graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n👋 Shutting down bot...');
            clearInterval(intervalId);
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n👋 Shutting down bot...');
            clearInterval(intervalId);
            process.exit(0);
        });
    }
}

// Bot実行
const bot = new GitHubDiscordBot();
bot.start().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
