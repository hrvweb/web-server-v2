// netlify/functions/login-else.js

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// Đặt khóa bí mật vào biến môi trường trên Netlify.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_SECRET_KEY;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!supabaseUrl || !supabaseAnonKey || !encryptionKey) {
  return console.error("Missing environment variables!");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const algorithm = 'aes-256-cbc';

const encrypt = (text) => {
  const iv = crypto.randomBytes(16); // IV (Initialization Vector)
  const cipher = crypto.createCipheriv(algorithm, Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  try {
    const { id, password } = JSON.parse(event.body);

    if (!id || !password) {
      return {
        statusCode: 400,
        body: 'ID and password are required.'
      };
    }

    // Mã hóa dữ liệu
    const encryptedData = encrypt(password);

    // Sử dụng upsert để cập nhật hoặc chèn dữ liệu
    const { error } = await supabase
      .from('data-encode')
      .upsert([
        { id: id, data: encryptedData }
      ], {
        onConflict: 'id' // Xác định cột cần kiểm tra để biết có xung đột (đã tồn tại) hay không
      });

    if (error) {
      console.error(error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save data to database.' })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'success!'})
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};