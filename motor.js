import { requestI2CAccess } from "node-web-i2c";
import PCA9685 from "@chirimen/pca9685";

// グローバル変数
let pca_driver;
let isInitialized = false;

/**
 * PCA9685をサーボモーター用に初期化する
 * @returns {Promise<boolean>} 初期化が成功したかどうか
 */
export async function init_servo_driver() {
  try {
    const i2cAccess = await requestI2CAccess();
    const port = i2cAccess.ports.get(1); // サンプルコードに合わせてポート1を使用
    const pca_address = 0x40; // 一般的なPCA9685のデフォルトアドレス
    
    // ライブラリのPCA9685クラスをインスタンス化
    pca_driver = new PCA9685(port, pca_address);

    // サーボモーターの仕様に合わせて初期化
    // 引数: (最小パルス[秒], 最大パルス[秒], 可動角度[度])
    // 一般的なサーボ(0-180度)用に設定
    await pca_driver.init(0.0005, 0.0025, 180);
    
    console.log("PCA9685 initialized successfully.");
    isInitialized = true;
    return true;

  } catch (error) {
    console.error("Failed to initialize PCA9685:", error);
    return false;
  }
}

/**
 * 指定したチャンネルのサーボモーターを特定の角度に動かす
 * @param {number} channel - モーター番号 (0-15)
 * @param {number} angle - 角度 (0-180)
 */
export async function set_servo_angle(channel, angle) {
  if (!isInitialized) {
    console.error("Driver is not initialized. Call init_servo_driver() first.");
    return;
  }
  
  try {
    // ライブラリのsetServoメソッドを呼び出す
    await pca_driver.setServo(channel, angle);
  } catch (error) {
    console.error(`Failed to set angle for channel ${channel}:`, error);
  }
}