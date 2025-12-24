const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    try {
        const body = JSON.parse(event.body);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const emailId = body.data.email_id;

        // --- BƯỚC QUAN TRỌNG: Gọi Resend API để lấy nội dung đầy đủ ---
        const resendRes = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        
        if (!resendRes.ok) {
            console.error("Không lấy được nội dung từ Resend");
            return { statusCode: 500, body: "Resend API Error" };
        }

        const emailFullData = await resendRes.json();
        
        const sender = emailFullData.from;
        const subject = emailFullData.subject || "No Subject";
        // Lấy text, nếu không có thì lấy html (bỏ tag), nếu không có nữa thì báo nội dung trống
        const emailContent = emailFullData.text || 
                             emailFullData.html?.replace(/<[^>]*>?/gm, '').substring(0, 1900) || 
                             "Nội dung trống...";

        // --- BƯỚC 2: Tìm thread như cũ ---
        const threadsRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/threads/active`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const threadsData = await threadsRes.json();
        const activeThreads = threadsData.threads || [];
        const existingThread = activeThreads.find(t => 
            t.parent_id === FORUM_CHANNEL_ID && t.name === sender
        );

        let url = existingThread 
            ? `https://discord.com/api/v10/channels/${existingThread.id}/messages`
            : `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;

        // --- BƯỚC 3: Chuẩn bị gửi sang Discord ---
        const discordPayload = existingThread ? {
            embeds: [{
                title: `Re: ${subject}`,
                description: emailContent,
                color: 0x5865F2,
                timestamp: new Date().toISOString()
            }]
        } : {
            name: sender.substring(0, 100),
            message: {
                embeds: [{
                    title: subject,
                    author: { name: sender },
                    description: emailContent,
                    color: 0x5865F2,
                    timestamp: new Date().toISOString()
                }]
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                "Authorization": `Bot ${BOT_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(discordPayload)
        });

        return { statusCode: 200, body: "Success" };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, body: err.message };
    }
};
