// netlify/functions/signup.js

const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

// Hàm tạo ID 10 chữ số ngẫu nhiên
function generateRandom10DigitID() {
  return Math.floor(1000000000 + Math.random() * 9000000000);
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: ''
      };
    }

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Method Not Allowed' }),
      };
    }

    const { username, email, password } = JSON.parse(event.body);
    const userAgent = event.headers['user-agent'] || 'unknown';
    const ipAddress = event.headers['x-forwarded-for'] || 'unknown';

    if (!username || !email || !password) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Username, email, and password are required' }),
      };
    }

    let sessionId = event.headers.cookie
      ? event.headers.cookie.split('; ').find(row => row.startsWith('sessionId='))?.split('=')[1]
      : null;

    if (!sessionId) {
      sessionId = uuidv4();
      const { error: sessionError } = await supabaseServiceRole
        .from('sessions')
        .insert({ id: sessionId, ip_addresses: [ipAddress], user_agent: userAgent });

      if (sessionError) {
        return {
          statusCode: 500,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ message: 'Lỗi khi tạo session', error: sessionError }),
        };
      }
    }

    const { data: existingUsername, error: usernameCheckError } = await supabaseServiceRole
      .from('accounts')
      .select('username')
      .eq('username', username)
      .single();

    if (usernameCheckError && usernameCheckError.code !== 'PGRST116') {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Lỗi khi kiểm tra username', error: usernameCheckError }),
      };
    }
    
    if (existingUsername) {
      return {
        statusCode: 409,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Username is already taken.' }),
      };
    }

    const { data: userData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Lỗi đăng ký', error: authError }),
      };
    }

    const user = userData.user;
    const session = userData.session;
    
    let readableId;
    let isUnique = false;
    let attempts = 0;
    
    do {
        readableId = generateRandom10DigitID();
        const { data: existingAccount, error: accountIdCheckError } = await supabaseServiceRole
          .from('accounts')
          .select('id')
          .eq('id', readableId)
          .limit(1);

        if (accountIdCheckError && accountIdCheckError.code !== 'PGRST116') {
           return {
             statusCode: 500,
             headers: { 'Access-Control-Allow-Origin': '*' },
             body: JSON.stringify({ message: 'Lỗi khi kiểm tra ID', error: accountIdCheckError }),
           };
        }

        if (existingAccount && existingAccount.length === 0) {
            isUnique = true;
        }
        attempts++;
    } while (!isUnique && attempts < 10);

    if (!isUnique) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Failed to generate a unique account ID' }),
      };
    }

    const logEntry = {
        type: 'signup',
        timestamp: new Date().toISOString(),
        session_id: sessionId,
    };

    const { error: accountInsertError } = await supabaseServiceRole
      .from('accounts')
      .insert({
        id: readableId,
        username,
        user_id: user.id,
        logs: [logEntry],
        metadata: {
          "banner": null,
          "avatar": null,
          "nickname": username,
          "description": null,
          "is_private": false
        }
      });

    if (accountInsertError) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Lỗi khi tạo tài khoản', error: accountInsertError }),
      };
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${31536000}`,
      },
      body: JSON.stringify({
        message: 'Sign-up successful!',
        session: session,
        id: readableId,
        user_id: user.id,
      }),
    };

  } catch (err) {
    // Đoạn code này sẽ bắt mọi lỗi và in ra toàn bộ stack trace
    console.error('Lỗi không lường trước trong hàm:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Lỗi máy chủ nội bộ. Vui lòng xem logs để biết chi tiết.' }),
    };
  }
};
