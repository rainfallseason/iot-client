import {requestI2CAccess} from "./node_modules/node-web-i2c/index.js";
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

async function read_weather_data() {
  const i2cAccess = await requestI2CAccess();
  const port = i2cAccess.ports.get(1);
  
  }
}
