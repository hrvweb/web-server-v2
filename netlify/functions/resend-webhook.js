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
        console.log(`[DEBUG] Đang xử lý Email ID: ${emailId}`);

        // --- 1. GỌI RESEND API VỚI LOG CHI TIẾT ---
        const resendRes = await fetch(`https://api.resend.com/emails/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        
        const resendStatus = resendRes.status;
        console.log(`[DEBUG] Resend API Status: ${resendStatus}`);

        if (!resendRes.ok) {
            const errorText = await resendRes.text();
            console.error(`[ERROR] Resend API thất bại: ${errorText}`);
            return { statusCode: resendStatus, body: `Resend Error: ${errorText}` };
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

        // --- 3. GỬI FILE HTML QUA FORMDATA ---
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
            // Chuyển HTML thành file đính kèm
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
            console.error(`[ERROR] Discord API thất bại: ${discordErr}`);
            return { statusCode: discordRes.status, body: discordErr };
        }

        console.log("[DEBUG] Hoàn tất gửi tới Discord!");
        return { statusCode: 200, body: "Success" };

    } catch (err) {
        console.error("[CRITICAL ERROR]:", err.message);
        return { statusCode: 500, body: err.message };
    }
};
