
// Sử dụng node-fetch nếu Node.js của bạn < 18, nếu > 18 thì dùng fetch có sẵn
const FORUM_CHANNEL_ID = '1453409265468571789';
const BOT_TOKEN = process.env.BOT_TOKEN;

exports.handler = async (event) => {
    // 1. Chỉ chấp nhận phương thức POST từ Resend Webhook
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const body = JSON.parse(event.body);
        
        // Kiểm tra xem Resend có gửi đúng event email.received không
        if (body.type !== 'email.received') {
            return { statusCode: 200, body: "Not an email event" };
        }

        const payload = body.data;
        const sender = payload.from;
        const subject = payload.subject || "No Subject";
        const emailContent = payload.text?.substring(0, 2000) || "Nội dung trống (xem file đính kèm)";

        // 2. Lấy danh sách các Thread đang hoạt động trong Forum
        const threadsRes = await fetch(`https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads/active`, {
            headers: { 
                Authorization: `Bot ${BOT_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        const threadsData = await threadsRes.json();

        // Kiểm tra nếu API Discord trả về lỗi (Ví dụ: 401, 403, 404)
        if (!threadsRes.ok) {
            console.error("Discord API Error:", threadsData);
            return { statusCode: 500, body: `Discord API Error: ${threadsData.message}` };
        }

        // Tìm thread dựa trên địa chỉ email người gửi
        const activeThreads = threadsData.threads || [];
        const existingThread = activeThreads.find(t => t.name === sender);

        // 3. Chuẩn bị FormData để gửi nội dung và file sang Discord
        const formData = new FormData();
        
        const messagePayload = {
            embeds: [{
                title: subject,
                author: { name: sender },
                description: emailContent,
                footer: { text: "Hrv Clan Mail System" },
                timestamp: new Date().toISOString(),
                color: 0xFF7A00
            }]
        };

        let url;
        if (existingThread) {
            // Nếu đã có thread, gửi tin nhắn mới vào thread đó
            url = `https://discord.com/api/v10/channels/${existingThread.id}/messages`;
        } else {
            // Nếu chưa có, tạo bài đăng (Thread) mới trong Forum
            url = `https://discord.com/api/v10/channels/${FORUM_CHANNEL_ID}/threads`;
            messagePayload.name = sender; // Tên thread là email người gửi
        }

        formData.append('payload_json', JSON.stringify(messagePayload));
        
        // Đính kèm nội dung HTML thành file .html để xem trên Discord
        if (payload.html) {
            const blob = new Blob([payload.html], { type: 'text/html' });
            formData.append('files[0]', blob, 'content.html');
        }

        // 4. Gửi yêu cầu cuối cùng đến Discord
        const sendRes = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bot ${BOT_TOKEN}` },
            body: formData
        });

        if (!sendRes.ok) {
            const errorData = await sendRes.json();
            console.error("Failed to send message/thread:", errorData);
            return { statusCode: 500, body: "Failed to send to Discord" };
        }

        return { statusCode: 200, body: "Success" };

    } catch (err) {
        console.error("Server Error:", err);
        return { statusCode: 500, body: err.message };
    }
};
