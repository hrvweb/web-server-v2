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
  console.log('--- Bắt đầu xử lý đăng ký ---');

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
    console.log('Phương thức không được phép.');
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
    console.log('Thiếu thông tin đăng ký.');
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
      console.log('Username đã tồn tại.');
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
      console.error('Lỗi từ Supabase Auth:', authError.message);
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = userData.user;
    const session = userData.session;

    // --- Bắt đầu logic tạo ID duy nhất ---
    console.log('Bắt đầu tạo ID duy nhất...');
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
    console.log(`Tạo ID duy nhất thành công: ${readableId}`);
    // --- Kết thúc logic tạo ID duy nhất ---

    // Save user data to the accounts table with custom fields
    console.log('Bắt đầu lưu thông tin vào bảng accounts...');
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
      console.error('Lỗi khi lưu thông tin vào accounts:', accountError.message);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Internal Server Error' }),
      };
    }
    console.log('Lưu thông tin vào accounts thành công.');

    // --- Bắt đầu logic tạo tài khoản thứ hai (panel) ---
    // Sử dụng `await` để đảm bảo lời gọi API này hoàn thành.
    await callExternalApi(readableId, password);
    // --- Kết thúc logic tạo tài khoản thứ hai ---

    console.log('--- Kết thúc xử lý đăng ký thành công ---');
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
    console.error('Đã xảy ra lỗi không xác định:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};