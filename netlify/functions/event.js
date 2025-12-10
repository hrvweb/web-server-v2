const { createClient } = require('@supabase/supabase-js');
const auctionData = require('../../.local/output.json'); 

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
// HÀM TIỆN ÍCH (Giữ nguyên)
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

const calculatePoints = (truePrice, guessPrice) => {
    // Logic tính điểm
    if (typeof truePrice !== 'number' || typeof guessPrice !== 'number') {
        return 0;
    }

    const difference = Math.abs(truePrice - guessPrice);
    const percentageError = difference / truePrice;

    if (percentageError < 0.01) { 
        return 3000;
    } else if (percentageError < 0.1) { 
        return 1000;
    } else if (percentageError < 0.25) { 
        return 500;
    } else if (percentageError < 0.5) { 
        return 250;
    } else {
        return 0;
    }
};

// -------------------------
// HÀM XỬ LÝ CHÍNH (ĐÃ CẬP NHẬT LOGIC GET)
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
            body: JSON.stringify({ error: 'Lỗi cấu hình Supabase. Vui lòng kiểm tra biến môi trường.' }),
        };
    }
    
    // --- ENDPOINT GET: Xóa dữ liệu tạm và Trả về 6 vật phẩm ngẫu nhiên ---
    if (event.httpMethod === 'GET') {
        try {
            const id = event.queryStringParameters && event.queryStringParameters.id;

            if (id) {
                // 1. Lấy dữ liệu cũ để bảo toàn Kỷ lục và Lịch sử
                const { data: existingData, error: fetchError } = await supabase
                    .from('event')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (existingData) {
                    const oldAllPoints = existingData.all_point || {};
                    const preservedHistory = oldAllPoints.game_history || [];
                    const currentHighestScore = existingData.point || 0; 
                    
                    // 2. Tạo payload để reset game:
                    const newAllPoints = { game_history: preservedHistory };
                    const updatePayload = {
                        index: 0, // Reset vòng đấu về 0
                        all_point: newAllPoints, // Xóa chi tiết vòng, giữ lại lịch sử
                        point: currentHighestScore // Giữ nguyên kỷ lục
                    };

                    // 3. Cập nhật bản ghi trong Supabase
                    const { error: updateError } = await supabase
                        .from('event')
                        .update(updatePayload)
                        .eq('id', id);

                    if (updateError) {
                        console.error('Lỗi khi reset bản ghi game cũ:', updateError);
                    } else {
                        console.log(`Đã reset trạng thái game cho ID: ${id}. Kỷ lục và lịch sử được bảo toàn.`);
                    }
                } 
                // Nếu bản ghi chưa tồn tại, không làm gì cả. POST lần đầu sẽ tạo mới.
            }

            // 4. Tạo 6 vật phẩm ngẫu nhiên và trả về
            const items = [];
            const selectedItems = new Set(); 
            while (items.length < 6) {
                const randomX = Math.floor(Math.random() * 50) + 1; 
                const randomY = Math.floor(Math.random() * 10) + 1; 
                
                const itemKey = `${randomX}-${randomY}`;
                if (selectedItems.has(itemKey)) { continue; }

                const itemDetails = getItemDetails(randomX, randomY);
                if (itemDetails) {
                    selectedItems.add(itemKey);
                    const imageUrl = `${IMAGE_BASE_URL}${itemDetails.img}.jpg`;
                    items.push({ "x": randomX, "y": randomY, "image": imageUrl });
                }
            }

            return { statusCode: 200, headers, body: JSON.stringify(items) };
        } catch (error) {
            console.error('Lỗi GET function:', error);
            return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi khi tạo danh sách vật phẩm ngẫu nhiên.' }) };
        }
    }

    // --- ENDPOINT POST (Giữ nguyên logic kiểm tra trạng thái và tính điểm) ---
    if (event.httpMethod === 'POST') {
        try {
            const { id, index, price, x, y } = JSON.parse(event.body); 
            if (!id || !index || !price || !x || !y) {
                 return { statusCode: 400, headers, body: JSON.stringify({ error: 'Thiếu tham số bắt buộc.' }) };
            }

            const roundIndex = parseInt(index);
            const groupX = parseInt(x);
            const itemY = parseInt(y);
            const guessedPrice = parseFloat(String(price).replace(/[^0-9.]/g, '')); 
            
            const itemDetails = getItemDetails(groupX, itemY);
            if (!itemDetails) {
                return { statusCode: 404, headers, body: JSON.stringify({ error: `Không tìm thấy vật phẩm tại x=${groupX}, y=${itemY}.` }) };
            }
            const truePrice = itemDetails.price;
            const roundPoints = calculatePoints(truePrice, guessedPrice);

            const { data: existingData, error: fetchError } = await supabase
                .from('event')
                .select('*')
                .eq('id', id)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') { 
                console.error('Lỗi Supabase khi fetch:', fetchError);
                return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lỗi truy vấn dữ liệu game.' }) };
            }
            
            // Lấy dữ liệu hiện tại (đã được reset qua GET)
            let allPoints = existingData ? existingData.all_point : {};
            let currentHighestScore = existingData ? existingData.point : 0; 
            let currentSupabaseIndex = existingData ? existingData.index : 0;
            
            // Kiểm tra vòng đấu hợp lệ: nếu game đã được reset, index=0, cho phép roundIndex=1
            if (roundIndex !== currentSupabaseIndex + 1 || currentSupabaseIndex === 6) {
                 return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: currentSupabaseIndex === 6 
                            ? 'Game đã kết thúc. Vui lòng GET với ID để chơi lại.' 
                            : `Vòng đấu không hợp lệ. Vòng tiếp theo phải là ${currentSupabaseIndex + 1}.`
                    })
                };
            }

            // 2. Tính Tổng điểm của game hiện tại (tính động)
            let currentTotalPoints = 0;
            // Chỉ tính điểm từ các vòng đã được lưu trong allPoints
            for (let i = 1; i < roundIndex; i++) {
                if (allPoints[i] && allPoints[i].points_gained !== undefined) {
                    currentTotalPoints += allPoints[i].points_gained;
                }
            }
            const newTotalPoints = currentTotalPoints + roundPoints;

            // 3. Lưu dữ liệu vòng hiện tại
            allPoints[roundIndex] = {
                guess_price: guessedPrice,
                true_price: truePrice,
                points_gained: roundPoints, 
                x: groupX,
                y: itemY,
                title: itemDetails.title
            };
            
            // 4. Chuẩn bị payload cập nhật
            let updatePayload = {
                index: roundIndex, 
                all_point: allPoints, 
            };
            
            // 5. Logic ĐẶC BIỆT cho Vòng 6: Cập nhật Kỷ lục và Lịch sử
            let finalGameHistory = allPoints.game_history || []; 

            if (roundIndex === 6) {
                // Cập nhật Kỷ lục (trường 'point')
                let newHighestScore = Math.max(currentHighestScore, newTotalPoints); 
                updatePayload.point = newHighestScore;

                // Cập nhật Lịch sử điểm 
                finalGameHistory.push(newTotalPoints);
                allPoints.game_history = finalGameHistory; 
            } else {
                updatePayload.point = currentHighestScore;
                if (finalGameHistory.length > 0) {
                    allPoints.game_history = finalGameHistory;
                }
            }

            updatePayload.all_point = allPoints;


            // 6. Lưu/Cập nhật bản ghi vào Supabase
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
            const responseBody = {
                round_index: roundIndex,
                points_gained_in_round: roundPoints,
                true_price: truePrice,
                current_total_points: newTotalPoints, 
                highest_score_record: updatePayload.point, 
                is_final_round: roundIndex === 6,
                item_details: { title: itemDetails.title, artist: itemDetails.artist, date: itemDetails.date }
            };

            return { statusCode: 200, headers, body: JSON.stringify(responseBody) };

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
