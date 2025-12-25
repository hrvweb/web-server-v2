const { Webhook } = require('svix');

const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const WEBHOOK_SECRET = 'whsec_OWsuAnoOIREInulXw37XeyfE8dvvuvgo';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getAvatarUrl = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=128`;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    // --- 1. XÁC THỰC CHỮ KÝ BẰNG THƯ VIỆN SVIX ---
    const payload = event.body;
    const headers = {
        "svix-id": event.headers["svix-id"],
        "svix-timestamp": event.headers["svix-timestamp"],
        "svix-signature": event.headers["svix-signature"],
    };

    try {
        const wh = new Webhook(WEBHOOK_SECRET);
        // Thư viện sẽ tự so khớp chữ ký và kiểm tra timestamp
        wh.verify(payload, headers);
        console.log("[SECURITY] Webhook verified successfully!");
    } catch (err) {
        console.error("[SECURITY] Invalid webhook signature:", err.message);
        return { statusCode: 401, body: "Unauthorized: Invalid Signature" };
    }

    // --- 2. XỬ LÝ DỮ LIỆU SAU KHI XÁC THỰC ---
    try {
        const body = JSON.parse(payload);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const emailId = body.data.email_id;
        // Chờ 2.5s để Resend chuẩn bị dữ liệu API
        await sleep(2500); 

        const resendRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        
        if (!resendRes.ok) return { statusCode: 500, body: "Resend API Error" };
        const emailData = await resendRes.json();
        
        // --- PHÂN TÍCH NGƯỜI GỬI / NHẬN ---
        const recipientEmail = emailData.to[0]; 
        const senderRaw = emailData.from; 
        const senderName = senderRaw.includes('<') ? senderRaw.split('<')[0].replace(/"/g, '').trim() : senderRaw;
        const senderEmail = senderRaw.includes('<') ? senderRaw.match(/<([^>]+)>/)?.[1] : senderRaw;

        const replyToInfo = (emailData.reply_to && emailData.reply_to.length > 0) 
            ? `\n**Reply-to:** ${emailData.reply_to.join(', ')}` 
            : "";

        // --- 3. ĐẨY DỮ LIỆU LÊN DISCORD FORUM ---
        const threadsRes = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/threads/active`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const threadsData = await threadsRes.json();
        const existingThread = (threadsData.threads || []).find(t => 
            t.parent_id === FORUM_CHANNEL_ID && t.name === recipientEmail
        );

        let url = existingThread 
            ? `https://discord.com/api/v10/channels/${existingThread.id}/messages`
            : `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;

        const embed = {
            author: { name: senderName, icon_url: getAvatarUrl(senderName) },
            title: emailData.subject || "No Subject",
            description: `**From:** ${senderEmail}${replyToInfo}`,
            color: 0x20ff00, // Màu xanh lá cực đẹp của bạn
            footer: { text: `To: ${recipientEmail}`, icon_url: getAvatarUrl(recipientEmail) },
            timestamp: new Date().toISOString()
        };

        const formData = new FormData();
        const messagePayload = existingThread ? { embeds: [embed] } : {
            name: recipientEmail,
            message: { embeds: [embed] }
        };

        formData.append('payload_json', JSON.stringify(messagePayload));

        // Đính kèm file nội dung để tránh tràn tin nhắn Discord
        let fileIndex = 0;
        if (emailData.text) {
            const textBlob = new Blob([emailData.text], { type: 'text/plain' });
            formData.append(`files[${fileIndex++}]`, textBlob, 'content.txt');
        }
        
        if (emailData.html) {
            const htmlBlob = new Blob([emailData.html], { type: 'text/html' });
            const htmlName = emailData.text ? 'view_rich_content.html' : 'content.html';
            formData.append(`files[${fileIndex++}]`, htmlBlob, htmlName);
        }

        const discordRes = await fetch(url, {
            method: 'POST',
            headers: { "Authorization": `Bot ${BOT_TOKEN}` },
            body: formData
        });

        if (!discordRes.ok) {
            const errorText = await discordRes.text();
            console.error("[ERROR] Discord API:", errorText);
            return { statusCode: 500, body: "Discord Error" };
        }

        return { statusCode: 200, body: "Success" };

    } catch (err) {
        console.error("[CRITICAL ERROR]:", err);
        return { statusCode: 500, body: err.message };
    }
};
