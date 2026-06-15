export const money = (value, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

export const number = (value, digits = 2) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: digits,
  }).format(Number(value || 0));

export const percent = (value) => `${number(value)}%`;

export const dateTime = (value) =>
  value ? new Date(value).toLocaleString("en-IN") : "--";

export const pnlTone = (value) =>
  Number(value) > 0 ? "success" : Number(value) < 0 ? "error" : "secondary";
