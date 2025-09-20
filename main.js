import { init_gnss_sensor, read_position_data } from './location.js';
import { init_servo_driver, set_servo_angle } from './motor.js';
import { init_weather_sensor, read_weather_data } from './weather.js';

const TARGET_URL = 'http://web-iot-makers-challenge-2025.vercel.app/api/devices/state';

// グローバル変数
let umbrella_is_open;
const UMBRELLA_OPEN_DEGREES = 0;
const UMBRELLA_CLOSE_DEGREES = 180;
const DUMMY_DATA = {
    deviceId: 1,
    temperature: 25.8,
    humidity: 48.7,
    latitude: 36.630938,
    longtitude: 138.189167
}; // 最悪センサーがフェイルした時にはこのダミーデータを下のdataの代わりに流してください

async function sendPost() {
    try {
        // 位置情報を読み取り
        const position = await read_position_data();
        
        // 気象データを読み取り
        const weather = await read_weather_data();
        
        const data = {
            deviceId: 1,
            temperature: weather ? weather.temperature : null,
            humidity: weather ? weather.humidity : null,
            latitude: position ? position.lat : null,
            longtitude: position ? position.long : null
        };

        const response = await fetch(TARGET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            let result;
            try {
                result = await response.json();
            } catch (jsonError) {
                console.log('Failed to parse JSON response:', jsonError);
                return;
            }
            
            // successがfalseの場合はログ出力
            if (!result.success) {
                console.log('Server returned success: false');
                return;
            }
            
            // isOpenとグローバル変数が違う場合はサーボを制御
            if (result.isOpen !== umbrella_is_open) {
                umbrella_is_open = result.isOpen;
                const angle = result.isOpen ? UMBRELLA_OPEN_DEGREES : UMBRELLA_CLOSE_DEGREES;
                await set_servo_angle(1, angle);
                await set_servo_angle(2, angle);
            }
        }

    } catch (error) {
        // エラーは無視
    }
}

// 初期化ルーチン
async function initialize() {
    await init_gnss_sensor();
    await init_servo_driver();
    await init_weather_sensor();
    
    // モーター1番と2番を0度に回す
    await set_servo_angle(1, UMBRELLA_OPEN_DEGREES);
    await set_servo_angle(2, UMBRELLA_OPEN_DEGREES);
    
    // モーターを回した後にグローバル変数を設定
    umbrella_is_open = true;
}

// 初期化してからインターバル開始
initialize().then(() => {
    // 5秒おきに送信
    setInterval(sendPost, 5000);
    
    // 即座に最初の送信
    sendPost();
});