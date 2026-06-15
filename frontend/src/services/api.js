import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
  headers: { Accept: "application/json" },
});

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status || null;
    this.path = options.path || "";
    this.isUnavailable = !this.status || this.status >= 500;
  }
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.message ||
      error.message ||
      "Unable to reach the trading backend";
    return Promise.reject(
      new ApiError(message, {
        status: error.response?.status,
        path: error.config?.url,
      })
    );
  }
);

export const getData = async (path) => {
  const response = await api.get(path);
  return response.data?.data ?? response.data;
};

export const postData = async (path, body = {}) => {
  const response = await api.post(path, body);
  return response.data?.data ?? response.data;
};

export const getDataSafe = async (path, fallback) => {
  try {
    return {
      data: await getData(path),
      error: null,
      unavailable: false,
    };
  } catch (error) {
    return {
      data: fallback,
      error,
      unavailable: Boolean(error.isUnavailable),
    };
  }
};

export const visibleError = (...results) =>
  results
    .map((result) => result?.error)
    .find((error) => error && !error.isUnavailable)?.message || "";

export default api;
