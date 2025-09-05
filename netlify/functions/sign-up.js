// netlify/functions/signup.js

import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

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

  // Tạo hoặc lấy session ID
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
        body: JSON.stringify({ message: 'Failed to create session' }),
      };
    }
  }

  try {
    // Đăng ký người dùng với Supabase Auth
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
    
    // Tạo ID 10 chữ số và kiểm tra tính duy nhất
    let accountId;
    let isUnique = false;
    let attempts = 0;
    
    do {
        accountId = generateRandom10DigitID();
        const { data: existingAccount, error } = await supabaseServiceRole
          .from('accounts')
          .select('id')
          .eq('id', accountId)
          .limit(1);

        if (existingAccount && existingAccount.length === 0) {
            isUnique = true;
        }
        attempts++;
    } while (!isUnique && attempts < 10); // Thử tối đa 10 lần để tránh vòng lặp vô hạn

    if (!isUnique) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: 'Failed to generate a unique account ID' }),
      };
    }

    // Tạo bản ghi tài khoản mới
    const { error: accountError } = await supabaseServiceRole
      .from('accounts')
      .insert({
        id: accountId, // Sử dụng ID ngẫu nhiên vừa tạo
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

    // Trả về token và session cho client
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
