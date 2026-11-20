"use strict";

(function (global) {
  const PATHS = {
    pill: '<path d="M10.5 20.5 20.5 10.5a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    capsule: '<rect x="4" y="8" width="16" height="8" rx="4" transform="rotate(-35 12 12)"/><path d="m9.5 8.5 5 7"/>',
    bottle: '<path d="M9 3h6v3H9z"/><path d="M8 6h8l2 3v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9l2-3Z"/><path d="M9 13h6M12 10v6"/>',
    dropper: '<path d="M12 3c2.5 3.6 6 7.5 6 11a6 6 0 1 1-12 0c0-3.5 3.5-7.4 6-11Z"/><path d="M10 15a2.5 2.5 0 0 0 2 2"/>',
    syringe: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3a2 2 0 0 1-2.8 0l-1.2-1.2a2 2 0 0 1 0-2.8L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
    thermometer: '<path d="M14 14.76V3.5a2 2 0 0 0-4 0v11.26a4.5 4.5 0 1 0 4 0Z"/><circle cx="12" cy="17.5" r="1.5" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    water: '<path d="M6 4h12l-1.5 15a2 2 0 0 1-2 1.8h-5a2 2 0 0 1-2-1.8L6 4Z"/><path d="M7.5 11h9"/>',
    meal: '<path d="M4 12h16a8 8 0 0 1-16 0Z"/><path d="M8 20h8M12 12V7M9 8V5M15 8V5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z"/>',
    bed: '<path d="M3 18v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"/><path d="M3 14h18M7 10v4"/>',
    baby: '<circle cx="12" cy="12" r="8"/><path d="M9.5 10.5h.01M14.5 10.5h.01"/><path d="M9.5 15a3.2 3.2 0 0 0 5 0"/><path d="M12 4c0 1.6-1 2.2-1 2.2"/>',
    elder: '<circle cx="12" cy="7" r="3.5"/><path d="M6 21v-3a5 5 0 0 1 10 0v3"/><path d="M18 11v10M18 11a1.5 1.5 0 0 1 3 0"/>',
    pregnant: '<circle cx="12" cy="5.5" r="2.5"/><path d="M10 10h3.5a3 3 0 0 1 2.5 4.6c1 1.1 1.2 2.9.2 4.1-.7.8-1.8 1.3-3.2 1.3H10v-10Z"/>',
    heart: '<path d="M12 20.5S4 15.5 4 9.5A4.5 4.5 0 0 1 12 6.8a4.5 4.5 0 0 1 8 2.7c0 6-8 11-8 11Z"/>',
    stomach: '<path d="M9 4v3a3 3 0 0 1-3 3 5 5 0 0 0 5 10h2a6 6 0 0 0 5.5-8.4A5 5 0 0 0 14 8.5V4"/>',
    eye: '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    nose: '<path d="M12 4v8.5a3.5 3.5 0 1 1-5 3.2"/><path d="M14.5 14.5a2.5 2.5 0 0 0 2.5 2"/>',
    tooth: '<path d="M7.5 4.5C5.2 4.5 4 6.7 4 9.2c0 3.4 1.6 10.3 3.6 10.3 1.4 0 1.8-3.8 4.4-3.8s3 3.8 4.4 3.8c2 0 3.6-6.9 3.6-10.3 0-2.5-1.2-4.7-3.5-4.7-1.6 0-2.9.9-4.5.9s-2.9-.9-4.5-.9Z"/>',
    shield: '<path d="M12 3 19 6v5.5c0 4.8-3 8-7 9.5-4-1.5-7-4.7-7-9.5V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    warning: '<path d="M10.3 3.9 2.3 18a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.8-5.2"/>',
    cross: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.7.5 1.1 1.3 1.2 2.1h4.6c.1-.8.5-1.6 1.2-2.1A6 6 0 0 0 12 3Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
    scale: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 10a5 5 0 0 1 10 0"/><path d="m12 10 2.5-2.5"/>',
    measure: '<path d="M5 4h14v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z"/><path d="M9 8h4M9 12h6M9 16h4"/>',
    doctor: '<circle cx="12" cy="7" r="3.5"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M12 13v5M9.5 15.5h5"/>',
    leaflet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5"/>',
    carton: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M4 10h16M9 14h6"/>',
    virus: '<circle cx="12" cy="12" r="5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    spark: '<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/>',
  };

  function svg(name, attrs = "") {
    const body = PATHS[name] || PATHS.pill;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${attrs ? " " + attrs : ""}>${body}</svg>`;
  }

  global.StageIcons = { svg, names: Object.keys(PATHS) };
})(globalThis);
