import BME680 from "@chirimen/bme680";

// グローバル変数
let bme_sensor;
let isInitialized = false;

/**
 * BME688センサーを初期化する
 * @returns {Promise<boolean>} 初期化が成功したかどうか
 */
export async function init_weather_sensor() {
  try {
    const i2cAccess = await navigator.requestI2CAccess();
    const port = i2cAccess.ports.get(1);
    // BME688のI2Cアドレスは通常0x76ですが、モジュールによっては0x77の場合もあります
    bme_sensor = new BME680(port, 0x76); 
    await bme_sensor.init();
    
    console.log("BME688 initialized successfully.");
    isInitialized = true;
    return true;

  } catch (error) {
    console.error("Failed to initialize BME688:", error);
    return false;
  }
}

/**
 * 気温、湿度、気圧を読み出し、指定された形式のオブジェクトとして返す
 * @returns {Promise<{temp: number, humid: number, press: number}|null>}
 */
export async function read_weather_data() {
  if (!isInitialized) {
    console.error("Sensor is not initialized. Call init_weather_sensor() first.");
    return null;
  }
  
  try {
    const val = await bme_sensor.readData();
    // ライブラリからの戻り値を、要求された形式に整形して返す
    return {
      temp: val.temperature,
      humid: val.humidity,
      press: val.pressure
    };
  } catch (error) {
    console.error("Failed to read weather data:", error);
    return null;
  }
}