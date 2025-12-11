// event.js
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// --- Cấu hình Đường dẫn và Mã hóa ---
const DATA_FILE_PATH = '../../.local/output.json';
const ENCRYPTION_KEY_HEX = 'd8a089c2ceb1045918a2198991f78b0d2bed29c1729eabaa3e6bcfeaff92d14f';

// Khóa mã hóa
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
const ALGORITHM = 'aes-256-gcm'; 
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// Tải dữ liệu 
const auctionData = require(DATA_FILE_PATH); 

// Biến môi trường
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const IMAGE_BASE_URL = 'https://auction-game.neal.fun/';

// Khởi tạo Supabase Client
let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}

// -------------------------
// HÀM MÃ HÓA (AES-256-GCM)
// -------------------------

function encrypt(text) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();

    return iv.toString('hex') + tag.toString('hex') + encrypted;
}

// -------------------------
// HÀM GIẢI MÃ (AES-256-GCM)
// -------------------------

function decrypt(encryptedText) {
    try {
        const iv = Buffer.from(encryptedText.substring(0, IV_LENGTH * 2), 'hex');
        const tag = Buffer.from(encryptedText.substring(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2), 'hex');
        const encrypted = encryptedText.substring((IV_LENGTH + TAG_LENGTH) * 2);

        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (e) {
        console.error('Lỗi giải mã:', e.message);
        return null; 
    }
}

// -------------------------
// HÀM TIỆN ÍCH
// -------------------------
const getItemDetails = (x, y) => {
    const groupKey = String(x);
    const itemIndex = y - 1; 
    const selectedGroup = auctionData[groupKey];
    if (selectedGroup && selectedGroup[itemIndex]) {
        return selectedGroup[itemIndex];
    }
    return null;
};

// Hàm định dạng Timestamp (YYYY-MM-DD HH:MM:SS)
const formatTimestamp = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
};

// -------------------------
// HÀM XỬ LÝ CHÍNH
// -------------------------

exports.handler = async (event, context) => {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    if (!supabase) {
         return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Lỗi cấu hình Supabase.' }),
        };
    }
    
    // --- ENDPOINT GET: Chỉ tạo game data và mã hóa ---
    if (event.httpMethod === 'GET') {
        try {
            // KHÔNG LẤY ID VÀ KHÔNG RESET DB Ở ĐÂY

            // 1. Tạo 6 vật phẩm ngẫu nhiên và chuẩn bị dữ liệu
            const public_items = [];
            const secret_data = []; 
            const selectedItems = new Set(); 
            
            while (public_items.length < 6) {
                const randomX = Math.floor(Math.random() * 50) + 1; 
                const randomY = Math.floor(Math.random() * 10) + 1; 
                
                const itemKey = `${randomX}-${randomY}`;
                if (selectedItems.has(itemKey)) { continue; }

                const itemDetails = getItemDetails(randomX, randomY);
                if (itemDetails) {
                    selectedItems.add(itemKey);
                    
                    const imageUrl = `${IMAGE_BASE_URL}${itemDetails.img}.jpg`;
                    
                    // Public Data
                    public_items.push({ 
                        "title": itemDetails.title,
                        "image": imageUrl,
                        "x": randomX, 
                        "y": randomY 
                    });
                    
                    // Secret Data 
                    secret_data.push({
                        "p": itemDetails.price, // Giá thật (price)
                        "x": randomX,
                        "y": randomY
                    });
                }
            }
            
            // 2. Mã hóa dữ liệu mật
            const plaintext = JSON.stringify({ items: public_items, prices: secret_data });
            const encryptedData = encrypt(plaintext);

            // 3. Trả về dữ liệu đã mã hóa 
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ 
                    "data": encryptedData 
                }) 
            };

        } catch (error) {
            console.error('Lỗi GET function:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi khi tạo/mã hóa vật phẩm.', details: error.message }) };
        }
    }

    // --- ENDPOINT POST: Giải mã điểm và lưu vào DB ---
    if (event.httpMethod === 'POST') {
        try {
            // Lấy ID từ Query Parameter (BẮT BUỘC)
            const id = event.queryStringParameters && event.queryStringParameters.id;
            const body = JSON.parse(event.body); 
            const encryptedScoreData = body.data;

            if (!id || !encryptedScoreData) {
                 return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Thiếu tham số bắt buộc: id (query parameter) hoặc data (body).' })
                };
            }
            
            // 1. Giải mã điểm số từ client
            const decryptedScoreString = decrypt(encryptedScoreData);
            if (!decryptedScoreString) {
                return { 
                    statusCode: 403, 
                    headers, 
                    body: JSON.stringify({ error: 'Dữ liệu điểm bị lỗi hoặc không hợp lệ.' }) 
                };
            }
            
            const newScore = parseInt(decryptedScoreString, 10);
            
            if (isNaN(newScore)) {
                 return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dữ liệu giải mã không phải là số điểm hợp lệ.' }) };
            }

            // 2. Lấy bản ghi hiện tại 
            const { data: existingData, error: fetchError } = await supabase
                .from('event')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') { 
                console.error('Lỗi Supabase khi fetch:', fetchError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi truy vấn dữ liệu game.' }) };
            }
            
            // Dữ liệu cũ
            let allPoints = existingData ? existingData.all_point || {} : {};
            let currentHighestScore = existingData ? existingData.point : 0; 
            
            // 3. Tính toán Kỷ lục mới
            let newHighestScore = Math.max(currentHighestScore, newScore); 

            // 4. Cập nhật Lịch sử điểm (Sử dụng timestamp làm key)
            const timestampKey = formatTimestamp(new Date());
            allPoints[timestampKey] = newScore; 

            // 5. Chuẩn bị payload cập nhật
            let updatePayload = {
                index: 6, // Đánh dấu đã hoàn thành game
                point: newHighestScore, 
                all_point: allPoints, 
            };
            
            // 6. Lưu/Cập nhật bản ghi
            let saveResult;
            if (existingData) {
                saveResult = await supabase
                    .from('event')
                    .update(updatePayload)
                    .eq('id', id)
                    .select()
                    .single();
            } else {
                updatePayload.id = id;
                saveResult = await supabase
                    .from('event')
                    .insert(updatePayload)
                    .select()
                    .single();
            }
            
            if (saveResult.error) {
                console.error('Lỗi Supabase khi lưu/cập nhật:', saveResult.error);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi khi lưu dữ liệu lên Supabase.' }) };
            }

            // 7. Trả về kết quả
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({
                    message: "Cập nhật thành công!",
                    submitted_score: newScore,
                    highest_score_record: newHighestScore,
                }) 
            };

        } catch (error) {
            console.error('Lỗi POST function:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi xử lý POST request.', details: error.message }) };
        }
    }

    return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Phương thức không được hỗ trợ.' })
    };
};