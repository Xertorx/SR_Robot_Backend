// Las fechas de agenda ("YYYY-MM-DD" y "HH:MM") se interpretan en la zona horaria del negocio (Bogotá por defecto)
const TZ_OFFSET = process.env.TZ_OFFSET || '-05:00';

const offsetMinutes = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(TZ_OFFSET);
  if (!m) return -300;
  return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
})();

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const isValidDate = (s) =>
  typeof s === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const isValidTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

const todayStr = () => new Date(Date.now() + offsetMinutes * 60000).toISOString().slice(0, 10);

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const dayKey = (dateStr) => DAY_KEYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];

const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const fromMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const slotStart = (date, time) => new Date(`${date}T${time}:00${TZ_OFFSET}`);

const addHours = (date, hours) => new Date(date.getTime() + hours * 3600000);
const addDaysToDate = (date, days) => new Date(date.getTime() + days * 86400000);

module.exports = {
  DAY_KEYS,
  isValidDate,
  isValidTime,
  todayStr,
  addDays,
  dayKey,
  toMinutes,
  fromMinutes,
  slotStart,
  addHours,
  addDaysToDate
};
