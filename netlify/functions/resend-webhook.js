const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hàm lấy Avatar từ tên (UI Avatars)
const getAvatarUrl = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=128`;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    try {
        const body = JSON.parse(event.body);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const emailId = body.data.email_id;
        await sleep(2500); // Chờ Resend chuẩn bị dữ liệu

        const resendRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        if (!resendRes.ok) return { statusCode: 500, body: "Resend Error" };
        
        const emailData = await resendRes.json();
        
        // 1. Phân tích thông tin
        const recipientEmail = emailData.to[0]; // Email nhận (info@...)
        const senderRaw = emailData.from; // "Tên <email@...>"
        const senderName = senderRaw.split('<')[0].trim() || senderRaw;
        const senderEmail = senderRaw.match(/<([^>]+)>/)?.[1] || senderRaw;

        // 2. Tìm hoặc tạo Thread theo Mail nhận
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

        // 3. Chuẩn bị FormData
        const formData = new FormData();
        const embed = {
            author: {
                name: senderName,
                icon_url: getAvatarUrl(senderName)
            },
            title: emailData.subject || "No Subject",
            description: `**Reply-to:** ${senderEmail}`,
            color: 0x2B2D31, // Màu tối sang trọng
            footer: {
                text: recipientEmail,
                icon_url: getAvatarUrl(recipientEmail)
            },
            timestamp: new Date().toISOString()
        };

        const messagePayload = existingThread ? { embeds: [embed] } : {
            name: recipientEmail,
            message: { embeds: [embed] }
        };

        formData.append('payload_json', JSON.stringify(messagePayload));

        // 4. Đính kèm file theo định dạng gọn đẹp
        if (emailData.text) {
            const textBlob = new Blob([emailData.text], { type: 'text/plain' });
            formData.append('files[0]', textBlob, 'content.txt');
        }
        
        if (emailData.html) {
            const htmlBlob = new Blob([emailData.html], { type: 'text/html' });
            const fileName = emailData.text ? 'view_web.html' : 'content.html';
            formData.append(`files[${emailData.text ? 1 : 0}]`, htmlBlob, fileName);
        }

        // 5. Gửi tới Discord
        await fetch(url, {
            method: 'POST',
            headers: { "Authorization": `Bot ${BOT_TOKEN}` },
            body: formData
        });

        return { statusCode: 200, body: "OK" };

    } catch (err) {
        console.error(err);
        return { statusCode: 500, body: err.message };
    }
};
