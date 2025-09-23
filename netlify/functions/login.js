// netlify/functions/login.js

const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey);

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

  const { email, password } = JSON.parse(event.body);
  const userAgent = event.headers['user-agent'] || 'unknown';
  const ipAddress = event.headers['x-forwarded-for'] || 'unknown';

  if (!email || !password) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
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
        statusCode: 401,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: authError.message }),
      };
    }

    const user = data.user;
    const session = data.session;
    
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
    } else {
      const { error: sessionUpdateError } = await supabaseServiceRole
        .from('sessions')
        .update({ ip_addresses: `{${ipAddress}}` })
        .eq('id', sessionId);
      if (sessionUpdateError) {
        console.error('Lỗi khi cập nhật session:', sessionUpdateError);
      }
    }
    
    const logEntry = {
        type: 'login',
        timestamp: new Date().toISOString(),
        session_id: sessionId,
    };
    
    const { data: accountsData, error: updateError } = await supabaseServiceRole
      .from('accounts')
      .update({ logs: logEntry })
      .eq('user_id', user.id);
    
    if (updateError) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Internal Server Error' }),
      };
    }
    
    const { data: accountData, error: accountError } = await supabaseServiceRole
      .from('accounts')
      .select('id, user_id')
      .eq('user_id', user.id)
      .single();

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
        message: 'Login successful!',
        session: session,
        id: accountData.id,
        user_id: accountData.user_id,
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
