// netlify/functions/sign-up.js
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

exports.handler = async (event) => {
  // 1. CHẶN GIẢ CHẾT
  if (event.httpMethod !== 'POST') {
    return { statusCode: 502, body: '' };
  }

  const clientIp = event.headers['x-nf-client-connection-ip'] || 
                   event.headers['x-forwarded-for']?.split(',')[0] || 
                   '127.0.0.1';

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { 'x-forwarded-for': clientIp } },
  });

  try {
    const { username, email, password } = JSON.parse(event.body || '{}');
    if (!username || !email || !password) return { statusCode: 502, body: '' };

    // 2. KIỂM TRA USERNAME NHANH
    const { data: existingUser } = await supabaseServiceRole
      .from('accounts')
      .select('username')
      .eq('username', username)
      .maybeSingle();

    if (existingUser) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Username is already taken.' }),
      };
    }

    // 3. ĐĂNG KÝ AUTH
    const { data: authData, error: authError } = await supabase.auth.signUp({ email, password });
    if (authError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: authError.message }),
      };
    }

    // 4. QUẢN LÝ SESSION
    let sessionId = event.headers.cookie
      ? event.headers.cookie.split('; ').find(row => row.startsWith('sessionId='))?.split('=')[1]
      : uuidv4();

    // Luôn đảm bảo session tồn tại trong bảng sessions
    await supabaseServiceRole.from('sessions').upsert({ 
      id: sessionId, 
      ip_addresses: [clientIp], 
      user_agent: event.headers['user-agent'] || 'unknown' 
    }, { onConflict: 'id' });

    // 5. GỌI RPC ĐỂ TẠO ACCOUNT (Xử lý mọi thứ trong 1 nốt nhạc)
    const { data: readableId, error: rpcError } = await supabaseServiceRole.rpc('create_account_v2', {
      p_user_id: authData.user.id,
      p_username: username,
      p_session_id: sessionId,
      p_ip: clientIp
    });

    if (rpcError) throw rpcError;

    // 6. GỌI API BÊN NGOÀI (NẾU CÓ)
    // await callExternalApi(readableId, password);

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Sign-up successful!',
        id: readableId,
        user_id: authData.user.id,
        session: authData.session
      }),
    };

  } catch (err) {
    console.error('Signup Error:', err.message);
    return { statusCode: 502, body: '' };
  }
};
