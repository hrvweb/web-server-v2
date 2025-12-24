const FORUM_CHANNEL_ID = '1453409265468571789';
const BOT_TOKEN = process.env.BOT_TOKEN;

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405 };

    const body = JSON.parse(event.body);
    if (body.type !== 'email.received') return { statusCode: 200 };

    const payload = body.data;
    const sender = payload.from;
    const subject = payload.subject || "No Subject";

    try {
        // 1. Tìm Thread hiện có trong Forum (Dùng API Discord)
        const threadsRes = await fetch(`https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads/active`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const { threads } = await threadsRes.json();
        let existingThread = threads.find(t => t.name === sender);

        // 2. Chuẩn bị FormData để gửi cả Embed và File HTML
        const formData = new FormData();
        
        // Tạo nội dung JSON cho Discord Message
        const messagePayload = {
            embeds: [{
                title: subject,
                author: { name: sender },
                description: payload.text?.substring(0, 2000) || "Xem chi tiết file đính kèm",
                footer: { text: "Hrv Clan Mail System" },
                timestamp: new Date().toISOString(),
                color: 0xFF7A00
            }]
        };

        // Nếu tạo thread mới (bài đăng mới)
        if (!existingThread) {
            messagePayload.name = sender; // Tiêu đề bài đăng là email
        }

        formData.append('payload_json', JSON.stringify(messagePayload));
        
        // Đính kèm file HTML từ Resend
        const blob = new Blob([payload.html], { type: 'text/html' });
        formData.append('files[0]', blob, 'content.html');

        // 3. Gửi đến Discord
        let url = `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`; // Mặc định tạo mới
        if (existingThread) {
            url = `https://discord.com/api/v10/channels/${existingThread.id}/messages`; // Gửi vào thread cũ
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            body: formData
        });

        return { statusCode: 200, body: "Mail sent to Discord" };
    } catch (err) {
        console.error(err);
        return { statusCode: 500, body: err.message };
    }
};
