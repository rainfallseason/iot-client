import { requestI2CAccess } from "./node_modules/node-web-i2c/index.js";
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

// MAX-M10SのデフォルトI2Cアドレス (データシート P.13 )
const MAX_M10S_I2C_ADDR = 0x42;

// グローバル変数
let gnss_sensor;
let isInitialized = false;

/**
 * GNSSセンサーを初期化する
 * @returns {Promise<boolean>} 初期化が成功したかどうか
 */
export async function init_gnss_sensor() {
  try {
    const i2cAccess = await requestI2CAccess();
    const port = i2cAccess.ports.get(1);
    gnss_sensor = port.open(MAX_M10S_I2C_ADDR);

    // データシート上、デフォルト設定でNMEAデータが出力されるため、
    // 特定の初期化コマンドは不要。I2C接続を開くだけでよい。
    console.log("MAX-M10S initialized successfully.");
    isInitialized = true;
    return true;
  } catch (error) {
    console.error("Failed to initialize MAX-M10S:", error);
    return false;
  }
}

/**
 * 緯度と経度を読み出し、オブジェクトとして返す
 * @returns {Promise<{lat: number, long: number}|null>}
 */
export async function read_position_data() {
  if (!isInitialized) {
    console.error("Sensor is not initialized. Call init_gnss_sensor() first.");
    return null;
  }

  try {
    // 1. センサーからデータストリームを読み込む
    // u-bloxモジュールは通常、0xFFからストリームデータを読み出せる
    const buffer = await gnss_sensor.readBlock(0xFF, 255);
    const nmea_data = new TextDecoder().decode(buffer);

    // 2. NMEAデータからGGAセンテンスを探す (データシート P.13 )
    const lines = nmea_data.split('\r\n');
    for (const line of lines) {
      if (line.startsWith('$GNGGA') || line.startsWith('$GPGGA')) {
        const parts = line.split(',');

        // 測位品質(Fix quality)を確認 (0=無効, 1=GPS fix, ...)
        // parts[6]が'1'以上でないと、緯度経度は有効な値ではない
        if (parts.length > 6 && parseInt(parts[6], 10) > 0) {
          const lat_raw = parts[2];
          const lat_hemi = parts[3]; // 'N' or 'S'
          const long_raw = parts[4];
          const long_hemi = parts[5]; // 'E' or 'W'
          
          const lat = nmeaToDecimal(lat_raw, lat_hemi);
          const long = nmeaToDecimal(long_raw, long_hemi);

          return { lat, long };
        }
      }
    }

    // 有効なGGAセンテンスが見つからなかった場合
    console.log("No valid position fix found in the data stream.");
    return null;

  } catch (error) {
    // データがない場合、readBlockはエラーを投げることがある。これは正常な場合もある。
    if (error.message.includes('No ACK')) {
        console.log("No data available from GNSS module yet.");
    } else {
        console.error("Failed to read position data:", error);
    }
    return null;
  }
}

/**
 * NMEA形式の緯度経度(DDMM.MMMM)を10進数形式(Decimal Degrees)に変換する
 * @param {string} nmeaCoord - NMEA形式の座標文字列
 * @param {string} hemisphere - 'N', 'S', 'E', 'W'のいずれか
 * @returns {number} 10進数形式の座標
 */
function nmeaToDecimal(nmeaCoord, hemisphere) {
    let degrees, minutes;
    // 緯度はDDMM.MMMM, 経度はDDDMM.MMMM
    if (nmeaCoord.indexOf('.') - 2 > 2) { // Longitude
        degrees = parseFloat(nmeaCoord.substring(0, 3));
        minutes = parseFloat(nmeaCoord.substring(3));
    } else { // Latitude
        degrees = parseFloat(nmeaCoord.substring(0, 2));
        minutes = parseFloat(nmeaCoord.substring(2));
    }
  
    let decimal = degrees + (minutes / 60.0);
  
    if (hemisphere === 'S' || hemisphere === 'W') {
      decimal = -decimal;
    }
  
    return decimal;
}