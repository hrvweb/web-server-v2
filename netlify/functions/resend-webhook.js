const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    try {
        const body = JSON.parse(event.body);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const payload = body.data;
        const sender = payload.from;
        const subject = payload.subject || "No Subject";
        const emailContent = payload.text?.substring(0, 1900) || "Xem nội dung HTML đính kèm";

        // 1. Lấy tất cả active threads từ GUILD ID theo phát hiện của bạn
        const threadsRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/threads/active`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const threadsData = await threadsRes.json();

        // 2. Lọc ra thread thuộc forum này và có tên trùng với email người gửi
        const activeThreads = threadsData.threads || [];
        const existingThread = activeThreads.find(t => 
            t.parent_id === FORUM_CHANNEL_ID && t.name === sender
        );

        let url;
        let method = 'POST';
        let discordPayload = {};

        if (existingThread) {
            // Gửi vào thread cũ
            url = `https://discord.com/api/v10/channels/${existingThread.id}/messages`;
            discordPayload = {
                embeds: [{
                    title: `Re: ${subject}`,
                    description: emailContent,
                    color: 0x5865F2,
                    timestamp: new Date().toISOString()
                }]
            };
        } else {
            // Tạo thread mới trong Forum
            url = `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;
            discordPayload = {
                name: sender.substring(0, 100),
                message: {
                    embeds: [{
                        title: subject,
                        description: emailContent,
                        color: 0x5865F2,
                        timestamp: new Date().toISOString()
                    }]
                }
            };
        }

        // 3. Thực thi gửi tin nhắn/tạo thread
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                "Authorization": `Bot ${BOT_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(discordPayload)
        });

        if (!response.ok) {
            const error = await response.json();
            console.error("Discord Error:", error);
            return { statusCode: response.status, body: JSON.stringify(error) };
        }

        return { statusCode: 200, body: "Success" };

    } catch (err) {
        return { statusCode: 500, body: err.message };
    }
};
