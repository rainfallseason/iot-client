import { requestI2CAccess } from "./node_modules/node-web-i2c/index.js";
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

// PCA9685のI2Cアドレス（A0-A5がGNDの場合）
const PCA9685_I2C_ADDR = 0x40;

// レジスタアドレス (データシート P.10-13参照)
const PCA9685_REG = {
  MODE1: 0x00,
  PRE_SCALE: 0xFE,
  LED0_ON_L: 0x06, // 各チャンネルの開始アドレス
};

// サーボモーターの一般的な設定
const SERVO_FREQ = 50; // 50Hz (20ms周期)
const SERVO_MIN_PULSE = 500; // 0度の時のパルス幅 (マイクロ秒)
const SERVO_MAX_PULSE = 2500; // 180度の時のパルス幅 (マイクロ秒)

// グローバル変数
let pca9685;
let isInitialized = false;

/**
 * PCA9685をサーボモーター用に初期化する
 * @param {number} i2c_addr - PCA9685のI2Cアドレス
 * @param {number} freq - PWM周波数 (Hz)
 * @returns {Promise<boolean>} 初期化が成功したかどうか
 */
export async function init_servo_driver(i2c_addr = PCA9685_I2C_ADDR, freq = SERVO_FREQ) {
  try {
    const i2cAccess = await requestI2CAccess();
    const port = i2cAccess.ports.get(0);
    pca9685 = port.open(i2c_addr);

    // 1. リセットして初期状態へ
    await pca9685.write8(PCA9685_REG.MODE1, 0x00); // RESTARTを無効化してリセット

    // 2. PWM周波数を設定 (データシート P.25)
    // 内部オシレータは25MHz 
    const osc_clock = 25000000;
    // プリスケール値の計算式 
    let prescale = Math.round(osc_clock / (4096 * freq)) - 1;

    // プリスケール値を設定するために一度スリープモードにする 
    const oldmode = await pca9685.read8(PCA9685_REG.MODE1);
    const newmode = (oldmode & 0x7F) | 0x10; // SLEEPビットを立てる
    await pca9685.write8(PCA9685_REG.MODE1, newmode);
    await pca9685.write8(PCA9685_REG.PRE_SCALE, prescale);

    // スリープモードから復帰
    await pca9685.write8(PCA9685_REG.MODE1, oldmode);
    await sleep(5); // オシレータが安定するまで待つ 

    // RESTARTビットを立ててPWMを再開
    await pca9685.write8(PCA9685_REG.MODE1, oldmode | 0x80); // RESTARTビット

    console.log(`PCA9685 initialized at ${freq}Hz.`);
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
  if (channel < 0 || channel > 15) {
    console.error("Channel must be between 0 and 15.");
    return;
  }
  if (angle < 0 || angle > 180) {
    console.error("Angle must be between 0 and 180.");
    return;
  }

  try {
    // 1. 角度をマイクロ秒単位のパルス幅に変換
    const pulse_us = SERVO_MIN_PULSE + (angle / 180) * (SERVO_MAX_PULSE - SERVO_MIN_PULSE);

    // 2. パルス幅を12bit(0-4095)の分解能の"tick"に変換
    const period_us = 1000000 / SERVO_FREQ;
    const tick = Math.round((pulse_us / period_us) * 4095);

    // 3. ON/OFFのtickを計算し、レジスタに書き込む
    // ONはtick 0から開始し、計算したtick数だけONにする
    const on_tick = 0;
    const off_tick = tick;
    
    // 4バイトのデータを一度に書き込む
    const data = new Uint8Array([
      on_tick & 0xFF,       // ON_L
      (on_tick >> 8) & 0x0F,  // ON_H
      off_tick & 0xFF,      // OFF_L
      (off_tick >> 8) & 0x0F, // OFF_H
    ]);

    const start_reg = PCA9685_REG.LED0_ON_L + (channel * 4);
    await pca9685.writeBlock(start_reg, data);
    
  } catch (error) {
    console.error(`Failed to set angle for channel ${channel}:`, error);
  }
}