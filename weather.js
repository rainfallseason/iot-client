import { requestI2CAccess } from "./node_modules/node-web-i2c/index.js";
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

// BME688のI2Cアドレス
const BME688_I2C_ADDR = 0x76; // SDOピンがGNDの場合

// レジスタアドレス (データシート参照)
const BME688_REG = {
  CHIP_ID: 0xD0,
  RESET: 0xE0,
  CTRL_HUM: 0x72,
  CTRL_MEAS: 0x74,
  CONFIG: 0x75,
  CTRL_GAS_1: 0x71,
  MEAS_STATUS_0: 0x1D,
  PRESS_MSB: 0x1F,
  // 較正データレジスタ
  CALIB_T1: 0xE9,
  CALIB_T2: 0x8A,
  CALIB_T3: 0x8C,
  CALIB_P1: 0x8E,
  CALIB_P2: 0x90,
  CALIB_P3: 0x92,
  CALIB_P4: 0x94,
  CALIB_P5: 0x96,
  CALIB_P6: 0x99,
  CALIB_P7: 0x98,
  CALIB_P8: 0x9C,
  CALIB_P9: 0x9E,
  CALIB_P10: 0xA0,
  CALIB_H1: 0xE2, // H1, H2は1つのレジスタに混在
  CALIB_H2: 0xE1,
  CALIB_H3: 0xE4,
  CALIB_H4: 0xE5,
  CALIB_H5: 0xE6,
  CALIB_H6: 0xE7,
  CALIB_H7: 0xE8,
};

// グローバル変数
let bme688;
let calib = {}; // 較正データを保持するオブジェクト
let t_fine = 0;   // 温度計算の中間値
let isInitialized = false;

/**
 * センサーを初期化し、較正データを読み込む
 * @returns {Promise<boolean>} 初期化が成功したかどうか
 */
export async function init_weather_sensor() {
  try {
    const i2cAccess = await requestI2CAccess();
    const port = i2cAccess.ports.get(0);
    bme688 = port.open(BME688_I2C_ADDR);

    // 1. センサーIDの確認
    const chipId = await bme688.read8(BME688_REG.CHIP_ID);
    if (chipId !== 0x61) {
      console.error(`Chip ID is not correct. Expected 0x61, but got 0x${chipId.toString(16)}`);
      return false;
    }

    // 2. ソフトリセット
    await bme688.write8(BME688_REG.RESET, 0xB6);
    await sleep(100); // リセット完了まで待機

    // 3. 較正データの読み込み
    await readCalibrationData();

    // 4. センサーの設定 (データシート P.19 "Quick start - Forced mode" 参照)
    // 湿度: オーバーサンプリングx1
    await bme688.write8(BME688_REG.CTRL_HUM, 0b001); // osrs_h<2:0> = x1

    // ガス測定を無効化
    await bme688.write8(BME688_REG.CTRL_GAS_1, 0b00010000); // run_gas = 0

    // 温度: x2, 気圧: x16, モード: sleep
    // osrs_t<7:5> = x2 (0b010)
    // osrs_p<4:2> = x16 (0b101)
    // mode<1:0> = sleep (0b00)
    const ctrlMeas = (0b010 << 5) | (0b101 << 2) | 0b00;
    await bme688.write8(BME688_REG.CTRL_MEAS, ctrlMeas);

    console.log("BME688 initialized successfully.");
    isInitialized = true;
    return true;
  } catch (error) {
    console.error("Failed to initialize BME688:", error);
    return false;
  }
}

/**
 * 気温、湿度、気圧を読み出し、オブジェクトとして返す
 * @returns {Promise<{temp: number, humid: number, press: number}|null>}
 */
export async function read_weather_data() {
  if (!isInitialized) {
    console.error("Sensor is not initialized. Call init_weather_sensor() first.");
    return null;
  }

  try {
    // 1. 強制モードで測定を開始
    const currentCtrlMeas = await bme688.read8(BME688_REG.CTRL_MEAS);
    const newCtrlMeas = (currentCtrlMeas & 0b11111100) | 0b01; // mode<1:0>をForced mode (01)に設定
    await bme688.write8(BME688_REG.CTRL_MEAS, newCtrlMeas);

    // 2. 測定完了を待つ (データシート P.43 `measuring` ビットを確認)
    let status;
    do {
      await sleep(10); // ポーリング間隔
      status = await bme688.read8(BME688_REG.MEAS_STATUS_0);
    } while ((status & 0b00100000) !== 0); // measuring<5>が0になるまで待つ

    // 3. 生データを一括で読み込む (気圧, 気温, 湿度)
    const data = await bme688.readBlock(BME688_REG.PRESS_MSB, 8);
    const adc_pres = (data[0] << 12) | (data[1] << 4) | (data[2] >> 4);
    const adc_temp = (data[3] << 12) | (data[4] << 4) | (data[5] >> 4);
    const adc_hum = (data[6] << 8) | data[7];

    // 4. データを補正計算して物理量に変換
    const temp = compensate_T(adc_temp);
    const press = compensate_P(adc_pres);
    const humid = compensate_H(adc_hum);
    
    return {
      temp: temp,     // 単位: °C
      humid: humid,   // 単位: %RH
      press: press    // 単位: hPa
    };

  } catch (error) {
    console.error("Failed to read weather data:", error);
    return null;
  }
}


// --- 内部ヘルパー関数 ---

/**
 * センサーから較正データを読み込み、グローバル変数calibに格納する
 */
async function readCalibrationData() {
  // Temperature
  const t1 = await bme688.readU16LE(BME688_REG.CALIB_T1);
  const t2 = await bme688.readS16LE(BME688_REG.CALIB_T2);
  const t3 = await bme688.readS8(BME688_REG.CALIB_T3);
  calib.par_t1 = t1;
  calib.par_t2 = t2;
  calib.par_t3 = t3;
  
  // Pressure
  const p1 = await bme688.readU16LE(BME688_REG.CALIB_P1);
  const p2 = await bme688.readS16LE(BME688_REG.CALIB_P2);
  const p3 = await bme688.readS8(BME688_REG.CALIB_P3);
  const p4 = await bme688.readS16LE(BME688_REG.CALIB_P4);
  const p5 = await bme688.readS16LE(BME688_REG.CALIB_P5);
  const p6 = await bme688.readS8(BME688_REG.CALIB_P6);
  const p7 = await bme688.readS8(BME688_REG.CALIB_P7);
  const p8 = await bme688.readS16LE(BME688_REG.CALIB_P8);
  const p9 = await bme688.readS16LE(BME688_REG.CALIB_P9);
  const p10 = await bme688.readU8(BME688_REG.CALIB_P10);
  calib.par_p1 = p1;
  calib.par_p2 = p2;
  calib.par_p3 = p3;
  calib.par_p4 = p4;
  calib.par_p5 = p5;
  calib.par_p6 = p6;
  calib.par_p7 = p7;
  calib.par_p8 = p8;
  calib.par_p9 = p9;
  calib.par_p10 = p10;
  
  // Humidity
  const h1_part1 = await bme688.readU8(BME688_REG.CALIB_H1); // 0xE2
  const h1_part2 = await bme688.readU8(0xE3);
  calib.par_h1 = (h1_part2 << 4) | (h1_part1 & 0x0F);
  
  const h2_part1 = await bme688.readU8(BME688_REG.CALIB_H2); // 0xE1
  const h2_part2 = await bme688.readU8(0xE2);
  calib.par_h2 = (h2_part1 << 4) | (h2_part2 >> 4);
  
  calib.par_h3 = await bme688.readS8(BME688_REG.CALIB_H3);
  calib.par_h4 = await bme688.readS8(BME688_REG.CALIB_H4);
  calib.par_h5 = await bme688.readS8(BME688_REG.CALIB_H5);
  calib.par_h6 = await bme688.readU8(BME688_REG.CALIB_H6);
  calib.par_h7 = await bme688.readS8(BME688_REG.CALIB_H7);
}


/**
 * 生の温度データから摂氏温度を計算する (データシート P.23 整数版)
 * @param {number} adc_T - 生のADC値
 * @returns {number} 温度 (°C)
 */
function compensate_T(adc_T) {
    let var1 = (adc_T >> 3) - (calib.par_t1 << 1);
    let var2 = (var1 * calib.par_t2) >> 11;
    let var3_inner = (var1 >> 1) * (var1 >> 1);
    let var3 = ((var3_inner >> 12) * (calib.par_t3 << 4)) >> 14;
    t_fine = var2 + var3;
    const temp_comp = ((t_fine * 5) + 128) >> 8;
    return temp_comp / 100.0;
}

/**
 * 生の気圧データからヘクトパスカルを計算する (データシート P.24 整数版)
 * @param {number} adc_P - 生のADC値
 * @returns {number} 気圧 (hPa)
 */
function compensate_P(adc_P) {
    let var1 = (t_fine >> 1) - 64000;
    let var2 = (((var1 >> 2) * (var1 >> 2)) >> 11) * calib.par_p6;
    var2 = var2 + ((var1 * calib.par_p5) << 1);
    var2 = (var2 >> 2) + (calib.par_p4 << 16);
    let var3 = (((var1 >> 2) * (var1 >> 2)) >> 13);
    var1 = ((var3 * (calib.par_p3 << 5)) >> 3) + ((calib.par_p2 * var1) >> 1);
    var1 = var1 >> 18;
    var1 = ((32768 + var1) * calib.par_p1) >> 15;

    if (var1 === 0) {
        return 0; // ゼロ除算を防止
    }
    
    let press_comp = 1048576 - adc_P;
    press_comp = Math.floor((((press_comp << 31) / var1)) / 2) * 2; // JavaScriptの除算は浮動小数点なので、整数演算を模倣
    press_comp = Math.floor(press_comp / 2);

    var1 = (calib.par_p9 * (((press_comp >> 3) * (press_comp >> 3)) >> 13)) >> 12;
    var2 = ((press_comp >> 2) * calib.par_p8) >> 13;
    let var4 = ((press_comp >> 8) * (press_comp >> 8) * (press_comp >> 8) * calib.par_p10) >> 17;

    press_comp = press_comp + ((var1 + var2 + var4 + (calib.par_p7 << 7)) >> 4);
    
    return press_comp / 100.0;
}

/**
 * 生の湿度データから相対湿度を計算する (データシート P.26 整数版)
 * @param {number} adc_H - 生のADC値
 * @returns {number} 相対湿度 (%RH)
 */
function compensate_H(adc_H) {
    const temp_scaled = t_fine;
    let var1 = adc_H - (calib.par_h1 << 4) - Math.floor((temp_scaled * calib.par_h3) / 100 >> 1);
    let var2 = (calib.par_h2 * (Math.floor((temp_scaled * calib.par_h4) / 100) + Math.floor(((temp_scaled * Math.floor((temp_scaled * calib.par_h5) / 100)) >> 6) / 100) + (1 << 14))) >> 10;
    let var3 = var1 * var2;
    let var4 = ((calib.par_h6 << 7) + Math.floor((temp_scaled * calib.par_h7) / 100)) >> 4;
    let var5 = ((var3 >> 14) * (var3 >> 14)) >> 10;
    let var6 = (var4 * var5) >> 1;
    let hum_comp = (var3 + var6) >> 12;
    hum_comp = (((hum_comp * 1000) >> 12));
    
    return hum_comp / 1024.0;
}
