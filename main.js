import { init_gnss_sensor } from './location.js';
import { init_servo_driver, set_servo_angle } from './motor.js';
import { init_weather_sensor } from './weather.js';

const TARGET_URL = 'http://somewhere/device/state';

// グローバル変数
let umbrella_is_open;

async function sendPost() {
    try {
        const data = {
            timestamp: new Date().toISOString(),
            message: 'data'
        };

        await fetch(TARGET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

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
    await set_servo_angle(1, 0);
    await set_servo_angle(2, 0);
    
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