// netlify/functions/sign-up.js

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

// Hàm bất đồng bộ riêng để gọi API ngoài
const callExternalApi = async (userId, password) => {
  try {
    const response = await fetch('https://hrv-web-server-v2.netlify.app/api/login-else', {
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
    console.log('Phản hồi từ API ngoài:', response.status, responseBody);
  } catch (err) {
    console.error('Lỗi khi gọi API ngoài:', err);
  }
};

exports.handler = async (event) => {
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

  // --- Bắt đầu logic quản lý session tùy chỉnh ---
  let sessionId = event.headers.cookie
    ? event.headers.cookie.split('; ').find(row => row.startsWith('sessionId='))?.split('=')[1]
    : null;

  if (!sessionId) {
    sessionId = uuidv4();
    const { error: sessionError } = await supabaseServiceRole
      .from('sessions')
      .insert({ id: sessionId, ip_addresses: [ipAddress], user_agent: userAgent });

    if (sessionError) {
      console.error('Lỗi khi tạo session:', sessionError);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Failed to create session' }),
      };
    }
  }
  // --- Kết thúc logic quản lý session tùy chỉnh ---

  try {
    const { data: existingUsername } = await supabaseServiceRole
      .from('accounts')
      .select('username')
      .eq('username', username)
      .single();
    
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
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = userData.user;
    const session = userData.session;
    
    // --- Bắt đầu logic tạo ID duy nhất ---
    let readableId;
    let isUnique = false;
    let attempts = 0;
    
    do {
        readableId = generateRandom10DigitID();
        const { data: existingAccount } = await supabaseServiceRole
          .from('accounts')
          .select('id')
          .eq('id', readableId)
          .limit(1);

        if (existingAccount && existingAccount.length === 0) {
            isUnique = true;
        }
        attempts++;
    } while (!isUnique && attempts < 10);

    if (!isUnique) {
      console.error('Không thể tạo ID duy nhất sau 10 lần thử.');
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Failed to generate a unique account ID' }),
      };
    }
    // --- Kết thúc logic tạo ID duy nhất ---

    // Save user data to the accounts table with custom fields
    const logEntry = {
        type: 'signup',
        timestamp: new Date().toISOString(),
        session_id: sessionId,
    };

    const { error: accountError } = await supabaseServiceRole
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

    if (accountError) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Internal Server Error' }),
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
        **session**: session,
        **id**: readableId,
        **user_id**: user.id,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};