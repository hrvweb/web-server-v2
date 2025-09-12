// netlify/functions/login.js

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: 'Method Not Allowed' }),
    };
  }

  const { email, password } = JSON.parse(event.body);

  if (!email || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Email and password are required' }),
    };
  }

  try {
    const { data, error: authError } = await supabase.auth.signInWithPassword({
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
    
    // Lấy ID dễ nhớ từ bảng accounts
    const { data: accountData, error: accountError } = await supabaseServiceRole
      .from('accounts')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (accountError || !accountData) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'User data not found' }),
      };
    }

    // Trả về phản hồi chỉ với các thông tin cần thiết
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Login successful!',
        token: accessToken,
        id: accountData.id,
        user_id: user.id
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};
