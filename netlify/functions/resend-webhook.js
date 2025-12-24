const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Hàm hỗ trợ chờ đợi
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    try {
        const body = JSON.parse(event.body);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const emailId = body.data.email_id;
        console.log(`[DEBUG] Nhận Webhook cho ID: ${emailId}. Đang chờ 2 giây...`);

        // CHỜ 2 GIÂY để Resend kịp lưu Email vào Database của họ
        await sleep(2000);

        // --- 1. GỌI RESEND API ---
        const resendRes = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        
        if (!resendRes.ok) {
            const errorText = await resendRes.text();
            console.error(`[ERROR] Resend API vẫn báo 404 hoặc lỗi: ${errorText}`);
            return { statusCode: resendRes.status, body: errorText };
        }

        const emailFullData = await resendRes.json();
        const sender = emailFullData.from;
        const subject = emailFullData.subject || "No Subject";
        const emailContent = emailFullData.text?.substring(0, 1900) || "Nội dung văn bản trống...";

        // --- 2. TÌM THREAD TRÊN DISCORD ---
        const threadsRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/threads/active`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const threadsData = await threadsRes.json();
        const existingThread = (threadsData.threads || []).find(t => 
            t.parent_id === FORUM_CHANNEL_ID && t.name === sender
        );

        let url = existingThread 
            ? `https://discord.com/api/v10/channels/${existingThread.id}/messages`
            : `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;

        // --- 3. GỬI QUA FORMDATA (CÓ FILE HTML) ---
        const formData = new FormData();
        const messagePayload = existingThread ? {
            embeds: [{ title: `Re: ${subject}`, description: emailContent, color: 0x5865F2 }]
        } : {
            name: sender.substring(0, 100),
            message: {
                embeds: [{ title: subject, author: { name: sender }, description: emailContent, color: 0x5865F2 }]
            }
        };

        formData.append('payload_json', JSON.stringify(messagePayload));

        if (emailFullData.html) {
            const htmlBlob = new Blob([emailFullData.html], { type: 'text/html' });
            formData.append('files[0]', htmlBlob, 'view-email.html');
        }

        const discordRes = await fetch(url, {
            method: 'POST',
            headers: { "Authorization": `Bot ${BOT_TOKEN}` },
            body: formData
        });

        if (!discordRes.ok) {
            const discordErr = await discordRes.text();
            console.error(`[ERROR] Discord API lỗi: ${discordErr}`);
            return { statusCode: discordRes.status, body: discordErr };
        }

        console.log("[DEBUG] Thành công!");
        return { statusCode: 200, body: "Success" };

    } catch (err) {
        console.error("[CRITICAL]:", err.message);
        return { statusCode: 500, body: err.message };
    }
};
