/* Funzioni pure Companion V20.4 — nessun accesso a DOM, archivio o rete.
   Esposte come CompanionCore in browser, disponibili nei test Node via module.exports. */
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  function localDate(value = new Date()) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  function dateAtNoon(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) throw new Error('Data non valida');
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(year, month - 1, day, 12);
    if (localDate(date) !== iso) throw new Error('Data non valida');
    return date;
  }
  function addDays(iso, offset) {
    const d = dateAtNoon(iso);
    d.setDate(d.getDate() + Number(offset));
    return localDate(d);
  }
  function startOfWeek(iso) {
    const d = dateAtNoon(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localDate(d);
  }
  function monthBounds(iso) {
    const d = dateAtNoon(iso);
    return [localDate(new Date(d.getFullYear(), d.getMonth(), 1, 12)),
      localDate(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))];
  }
  function shiftPeriod(iso, mode, step) {
    const base = iso || localDate();
    if (mode !== 'month') return addDays(base, Number(step) * (mode === 'week' ? 7 : 1));
    const d = dateAtNoon(base);
    const originalDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(step));
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
    d.setDate(Math.min(originalDay, maxDay));
    return localDate(d);
  }
  function daysUntil(iso, base = localDate()) {
    if (!iso) return null;
    const asUtcDay = value => {
      const d = dateAtNoon(value);
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    };
    return Math.round((asUtcDay(iso) - asUtcDay(base)) / 86400000);
  }
  // Accetta: 2000, 2.000, 2.000,00, 2000.50, 2,000.50 e 1.234.567.
  // Non interpreta stringhe non numeriche né raggruppamenti non validi.
  function parseEuro(value) {
    const raw = String(value ?? '').trim().replace(/[\s\u00a0\u202f€]/g, '');
    if (!raw) return 0;
    if (!/^-?\d[\d.,]*$/.test(raw)) return 0;
    const dot = raw.lastIndexOf('.');
    const comma = raw.lastIndexOf(',');
    let normalized;
    if (dot >= 0 && comma >= 0) {
      const italian = dot < comma;
      const re = italian ? /^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/ : /^-?\d{1,3}(?:,\d{3})+\.\d{1,2}$/;
      if (!re.test(raw)) return 0;
      normalized = italian ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (dot >= 0) {
      if (/^-?\d{1,3}(?:\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, '');
      else if (/^-?\d+\.\d{1,2}$/.test(raw)) normalized = raw;
      else return 0;
    } else if (comma >= 0) {
      if (/^-?\d{1,3}(?:,\d{3})+$/.test(raw)) normalized = raw.replace(/,/g, '');
      else if (/^-?\d+,\d{1,2}$/.test(raw)) normalized = raw.replace(',', '.');
      else return 0;
    } else normalized = raw;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }
  const api = Object.freeze({localDate, addDays, startOfWeek, monthBounds, shiftPeriod, daysUntil, parseEuro});
  root.CompanionCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self);
