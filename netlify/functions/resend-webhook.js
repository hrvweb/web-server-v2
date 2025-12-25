const GUILD_ID = "1208004053758509077";
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getAvatarUrl = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=128`;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    try {
        const body = JSON.parse(event.body);
        if (body.type !== 'email.received') return { statusCode: 200 };

        const emailId = body.data.email_id;
        await sleep(2500); 

        const resendRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
        });
        if (!resendRes.ok) return { statusCode: 500, body: "Resend Error" };
        
        const emailData = await resendRes.json();
        
        // --- XỬ LÝ THÔNG TIN NGƯỜI GỬI/NHẬN ---
        const recipientEmail = emailData.to[0]; 
        const senderRaw = emailData.from; 
        const senderName = senderRaw.includes('<') ? senderRaw.split('<')[0].replace(/"/g, '').trim() : senderRaw;
        const senderEmail = senderRaw.includes('<') ? senderRaw.match(/<([^>]+)>/)?.[1] : senderRaw;

        // Xử lý Reply-to (Chỉ hiện nếu có dữ liệu)
        const replyToInfo = (emailData.reply_to && emailData.reply_to.length > 0) 
            ? `\n**Reply-to:** ${emailData.reply_to.join(', ')}` 
            : "";

        // --- TÌM THREAD THEO EMAIL NHẬN ---
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

        // --- GIAO DIỆN EMBED VỚI MÀU 20ff00 ---
        const embed = {
            author: {
                name: senderName,
                icon_url: getAvatarUrl(senderName)
            },
            title: emailData.subject || "No Subject",
            description: `**From:** ${senderEmail}${replyToInfo}`,
            color: 0x20ff00, // Màu xanh lá bạn yêu cầu
            footer: {
                text: `To: ${recipientEmail}`,
                icon_url: getAvatarUrl(recipientEmail)
            },
            timestamp: new Date().toISOString()
        };

        const formData = new FormData();
        const messagePayload = existingThread ? { embeds: [embed] } : {
            name: recipientEmail,
            message: { embeds: [embed] }
        };

        formData.append('payload_json', JSON.stringify(messagePayload));

        // --- ĐÍNH KÈM FILE TÙY THEO ĐỊNH DẠNG ---
        let fileIndex = 0;
        if (emailData.text) {
            const textBlob = new Blob([emailData.text], { type: 'text/plain' });
            formData.append(`files[${fileIndex++}]`, textBlob, 'content.txt');
        }
        
        if (emailData.html) {
            const htmlBlob = new Blob([emailData.html], { type: 'text/html' });
            // Nếu đã có file txt thì file html tên là view_rich_content, nếu không thì là content.html
            const htmlName = emailData.text ? 'view_rich_content.html' : 'content.html';
            formData.append(`files[${fileIndex++}]`, htmlBlob, htmlName);
        }

        await fetch(url, {
            method: 'POST',
            headers: { "Authorization": `Bot ${BOT_TOKEN}` },
            body: formData
        });

        return { statusCode: 200, body: "Success" };

    } catch (err) {
        return { statusCode: 500, body: err.message };
    }
};
