// netlify/functions/signup.js 

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRER_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  const { username, email, password } = JSON.parse(event.body);
  const userAgent = event.headers['user-agent'] || 'unknown';
  const ipAddress = event.headers['x-forwarded-for'] || 'unknown';

  if (!username || !email || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Username, email, and password are required' }),
    };
  }

  // 1. Tạo hoặc lấy session ID từ cookie
  let sessionId = event.headers.cookie
    ? event.headers.cookie.split('; ').find(row => row.startsWith('sessionId='))?.split('=')[1]
    : null;

  // Nếu không có session ID, tạo một ID mới và lưu vào bảng sessions
  if (!sessionId) {
    sessionId = uuidv4();
    const { error: sessionError } = await supabaseServiceRole
      .from('sessions')
      .insert({ id: sessionId, ip_addresses: [ipAddress], user_agent: userAgent });

    if (sessionError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Failed to create session' }),
      };
    }
  }

  try {
    // 2. Đăng ký người dùng với Supabase Auth
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = data.user;
    const session = data.session;
    const accessToken = session.access_token;

    // 3. Tạo bản ghi tài khoản mới và lưu thông tin chi tiết
    const { error: accountError } = await supabaseServiceRole
      .from('accounts')
      .insert({
        username,
        user_id: user.id,
        logs: [{
          type: 'signup',
          timestamp: new Date().toISOString(),
          session_id: sessionId
        }],
        metadata: {
          "banner": null,
          "avatar": null,
          "nickname": username,
          "description": null,
          "is_private": false
        }
      });

    if (accountError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: accountError.message }),
      };
    }

    // 4. Trả về token và session cho client
    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `sessionId=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${31536000}`,
      },
      body: JSON.stringify({
        message: 'Sign-up successful!',
        accessToken: accessToken,
        userId: user.id,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
