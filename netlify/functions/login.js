// netlify/functions/login.js
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

// Admin Client (Service Role)
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

exports.handler = async (event) => {
  // 1. CHẶN GIẢ CHẾT (Dành cho request không phải POST)
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 502,
      body: '',
    };
  }

  // 2. LẤY IP THẬT TỪ NETLIFY
  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   event.headers['x-forwarded-for']?.split(',')[0] || 
                   '127.0.0.1';

  // 3. KHỞI TẠO ANON CLIENT VỚI IP CHUYỂN TIẾP
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { 'x-forwarded-for': clientIp },
    },
  });

  try {
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    if (!email || !password) {
      return { statusCode: 502, body: '' };
    }

    // 4. THỰC HIỆN ĐĂNG NHẬP
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = authData.user;
    const session = authData.session;
    const userAgent = event.headers['user-agent'] || 'unknown';

    // 5. QUẢN LÝ SESSION QUA COOKIE
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
    } else {
      // FIX LỖI: Sử dụng await đúng cú pháp cho RPC (không dùng .catch)
      await supabaseServiceRole.rpc('update_session_ip', { 
        s_id: sessionId, 
        new_ip: clientIp 
      });
    }

    // 6. GHI LOG ĐĂNG NHẬP BẰNG RPC
    const logEntry = {
      type: 'login',
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      ip: clientIp
    };

    await supabaseServiceRole.rpc('append_account_log', { 
      target_user_id: user.id, 
      new_log: logEntry 
    });

    // 7. LẤY DATA TÀI KHOẢN
    const { data: accData } = await supabaseServiceRole
      .from('accounts')
      .select('id')
      .eq('user_id', user.id)
      .single();

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Login successful!',
        session: session,
        id: accData?.id,
        user_id: user.id,
      }),
    };

  } catch (err) {
    // Log lỗi thật ra Netlify console để bạn theo dõi
    console.error('Login Fatal Error:', err.message);
    return {
      statusCode: 502,
      body: '',
    };
  }
};
