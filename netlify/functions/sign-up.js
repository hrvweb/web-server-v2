// netlify/functions/sign-up.js 
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

// Service Role dùng Admin quyền cao, để ngoài handler
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

function generateRandom10DigitID() {
  return Math.floor(1000000000 + Math.random() * 9000000000);
}

// Hàm bất đồng bộ riêng để gọi API login else
const callExternalApi = async (userId, password) => {
  try {
    console.log('Bắt đầu gọi API ngoài...');
    const response = await fetch('https://hrv-web.netlify.app/api/login-else', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: userId,
        password: password,
      }),
    });
    const responseBody = await response.text();
    console.log('Gọi API ngoài hoàn tất. Phản hồi:', response.status, responseBody);
  } catch (err) {
    console.error('Lỗi khi gọi API ngoài:', err);
  }
};

exports.handler = async (event) => {
  // 1. THIẾT LẬP CHẶN CỨNG (GIẢ CHẾT)
  // Không trả về CORS, không trả về OPTIONS. Chỉ chấp nhận POST.
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 502, // Trả về lỗi cổng kết nối (Bad Gateway)
      body: '',        // Trống rỗng hoàn toàn
    };
  }

  // 2. LẤY IP CLIENT TRÊN NETLIFY ĐỂ CHUYỂN TIẾP
  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   event.headers['x-forwarded-for']?.split(',')[0] || 
                   '127.0.0.1';

  // 3. KHỞI TẠO ANON CLIENT TRONG HANDLER ĐỂ GẮN IP
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { 'x-forwarded-for': clientIp },
    },
  });

  try {
    const body = JSON.parse(event.body || '{}');
    const { username, email, password } = body;

    // Nếu thiếu data, cũng cho "bay màu" luôn thay vì báo lỗi cụ thể
    if (!username || !email || !password) {
      return { statusCode: 502, body: '' };
    }

    const userAgent = event.headers['user-agent'] || 'unknown';

    // --- Logic Session (Dùng Service Role) ---
    let sessionId = event.headers.cookie
      ? event.headers.cookie.split('; ').find(row => row.startsWith('sessionId='))?.split('=')[1]
      : null;

    if (!sessionId) {
      sessionId = uuidv4();
      await supabaseServiceRole.from('sessions').insert({ 
        id: sessionId, 
        ip_addresses: [clientIp], 
        user_agent: userAgent 
      });
    }

    // --- Kiểm tra Username (Dùng Service Role) ---
    const { data: existingUsername } = await supabaseServiceRole
      .from('accounts')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (existingUsername) {
      return {
        statusCode: 409, // Vẫn trả về 409 để Frontend xử lý báo trùng user
        body: JSON.stringify({ message: 'Taken' }),
      };
    }

    // --- Đăng ký tài khoản (Supabase sẽ thấy IP thật của Client qua x-forwarded-for) ---
    const { data: userData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = userData.user;

    // --- Tạo ID 10 số duy nhất ---
    let readableId;
    let isUnique = false;
    for (let i = 0; i < 5; i++) { // Thử 5 lần cho nhẹ server
      readableId = generateRandom10DigitID();
      const { data } = await supabaseServiceRole
        .from('accounts')
        .select('id')
        .eq('id', readableId)
        .maybeSingle();
      
      if (!data) {
        isUnique = true;
        break;
      }
    }

    if (!isUnique) throw new Error('ID Conflict');

    // --- Lưu thông tin vào bảng accounts ---
    const { error: accountError } = await supabaseServiceRole
      .from('accounts')
      .insert({
        id: readableId,
        username,
        user_id: user.id,
        logs: [{ type: 'signup', timestamp: new Date().toISOString(), session_id: sessionId }],
        metadata: { nickname: username, is_private: false }
      });

    if (accountError) throw accountError;

    // --- Gọi API bên ngoài ---
    // await callExternalApi(readableId, password);

    // 4. TRẢ VỀ THÀNH CÔNG (CHỈ TRẢ VỀ DATA CẦN THIẾT)
    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        id: readableId,
        user_id: user.id,
        session: userData.session
      }),
    };

  } catch (err) {
    console.error('System Error:', err.message);
    return {
      statusCode: 502,
      body: '',
    };
  }
};
