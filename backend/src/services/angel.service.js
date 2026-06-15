const axios = require("axios");
const speakeasy = require("speakeasy");

const ANGEL_LOGIN_URL =
  "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword";
const REQUIRED_ENV_VARS = [
  "ANGEL_API_KEY",
  "ANGEL_CLIENT_CODE",
  "ANGEL_PIN",
  "ANGEL_TOTP_SECRET",
];
const LOGIN_TIMEOUT_MS = 10000;

const getAngelCredentials = () => {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    const error = new Error(
      `Missing required Angel One environment variables: ${missing.join(", ")}`
    );
    error.statusCode = 503;
    throw error;
  }

  return {
    apiKey: process.env.ANGEL_API_KEY.trim(),
    clientCode: process.env.ANGEL_CLIENT_CODE.trim(),
    pin: process.env.ANGEL_PIN.trim(),
    totpSecret: process.env.ANGEL_TOTP_SECRET.trim(),
  };
};

const logAngelError = (error) => {
  const status = error.response?.status;
  const errorCode = error.response?.data?.errorcode;
  const message = error.response?.data?.message || error.message;

  console.error("Angel One login failed", {
    status,
    errorCode,
    message,
  });
};

const loginAngel = async () => {
  try {
    const credentials = getAngelCredentials();
    const totp = speakeasy.totp({
      secret: credentials.totpSecret,
      encoding: "base32",
    });

    const response = await axios.post(
      ANGEL_LOGIN_URL,
      {
        clientcode: credentials.clientCode,
        password: credentials.pin,
        totp,
      },
      {
        timeout: LOGIN_TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": credentials.apiKey,
        },
      }
    );

    if (response.data?.status !== true) {
      const error = new Error(
        response.data?.message || "Angel One rejected the login request"
      );
      error.response = { status: response.status, data: response.data };
      throw error;
    }

    return {
      success: true,
      message: response.data?.message || "Angel One login successful",
      data: response.data?.data,
    };
  } catch (error) {
    logAngelError(error);

    const loginError = new Error(
      error.response?.data?.message || error.message || "Angel One login failed"
    );
    loginError.statusCode =
      error.statusCode || (error.response ? 502 : 503);
    throw loginError;
  }
};

module.exports = {
  loginAngel,
};
