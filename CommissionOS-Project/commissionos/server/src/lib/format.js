const formatINR = (amount) => {
  const num = Number(amount) || 0;
  const isNeg = num < 0;
  const abs = Math.abs(num);
  return `${isNeg ? '-' : ''}₹${abs.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: abs % 1 !== 0 ? 2 : 0,
  })}`;
};

// DD-MM-YYYY (the date format used throughout the UI)
const dmy = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

module.exports = { formatINR, dmy };
