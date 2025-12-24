// ID kênh Forum của bạn đã được dán trực tiếp vào đây
const FORUM_CHANNEL_ID = "1453409265468571789";
const BOT_TOKEN = process.env.BOT_TOKEN;

exports.handler = async (event) => {
    // Chỉ chấp nhận POST từ Resend Webhook
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const body = JSON.parse(event.body);
        
        // Kiểm tra đúng event từ Resend
        if (body.type !== 'email.received') {
            return { statusCode: 200, body: "Not an email event" };
        }

        const payload = body.data;
        const sender = payload.from;
        const subject = payload.subject || "No Subject";
        // Giới hạn 1900 ký tự để không bị lỗi Discord
        const emailContent = payload.text?.substring(0, 1900) || "Nội dung trống (xem file đính kèm)";

        // URL chuẩn để tạo bài đăng (thread) mới trong Forum
        const url = `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;

        // Cấu trúc Payload cho Forum Channel
        const discordPayload = {
            name: sender.substring(0, 100), // Tiêu đề bài đăng là Email người gửi
            message: {
                embeds: [{
                    title: subject,
                    author: { name: sender },
                    description: emailContent,
                    footer: { text: "Hrv Clan Mail System" },
                    timestamp: new Date().toISOString(),
                    color: 0x5865F2 // Màu Blurple
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

        const result = await response.json();

        if (!response.ok) {
            console.error("Lỗi từ Discord API:", result);
            return { statusCode: response.status, body: JSON.stringify(result) };
        }

        return { statusCode: 200, body: "Thread Created Successfully" };

    } catch (err) {
        console.error("Lỗi Server:", err);
        return { statusCode: 500, body: err.message };
    }
};

