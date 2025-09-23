// netlify/functions/sign-up.js

const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');

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

  const { email, password, username } = JSON.parse(event.body);

  if (!email || !password || !username) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Email, password, and username are required' }),
    };
  }

  try {
    // Check if the username is already taken
    const { data: existingUser } = await supabaseServiceRole
      .from('accounts')
      .select('username')
      .eq('username', username)
      .single();

    if (existingUser) {
      return {
        statusCode: 409,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Username is already taken.' }),
      };
    }

    // Sign up the user in Supabase Auth
    const { data: userData, error: authError } = await supabase.auth.signUp({
      email,
      password
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
    const accessToken = session.access_token;
    const refreshToken = session.refresh_token;

    // Create a unique, memorable ID
    const memorableId = nanoid(10);
    
    // Save the user data to the accounts table
    const { error: insertError } = await supabaseServiceRole
      .from('accounts')
      .insert({
        user_id: user.id,
        id: memorableId,
        username,
      });

    if (insertError) {
      console.error('Lỗi khi chèn vào bảng accounts:', insertError);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: 'Internal Server Error' }),
      };
    }
    
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        message: 'Sign up successful!',
        token: accessToken,
        refresh_token: refreshToken,
        id: memorableId,
        user_id: user.id
      }),
    };

  } catch (err) {
    console.error('Lỗi API không xác định:', err);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};