// Shared calendar data processing.
//
// This file is loaded in two contexts:
//   1. Inside calendar-worker.js via importScripts() (normal http(s) hosting).
//   2. Directly on the page via a <script> tag, used as a main-thread fallback
//      when the Worker constructor is unavailable (e.g. opening index.html from
//      a file:// URL, where workers are blocked as unique/null origins).
//
// Because plain top-level function declarations become properties of the global
// object in both a Worker (`self`) and a Window, the same code works in both.
// It depends on the LZString global, which the worker gets via importScripts and
// the page gets via its own <script> tag.

// ---------------------------------------------------------------------------
// Time-zone handling
// ---------------------------------------------------------------------------
//
// Raw Google events carry two independent pieces of time information:
//   - start/end.dateTime  – an absolute instant (always exported in one fixed
//                           offset, EET, regardless of where the user was).
//   - start/end.timeZone  – the IANA zone the user was physically in.
//
// If we naively read `new Date(dateTime)` in the browser, every activity is
// pinned to a single continuous absolute timeline: a dinner logged at 20:00 in
// Tokyo shows up at ~13:00 for a viewer in Madrid, shifting every stat. What we
// actually want is the *wall-clock time where the user was* — 20:00 stays 20:00.
//
// So we re-project each instant into its own timeZone and store the result as a
// "floating" ISO string with no offset (e.g. "2025-05-30T20:00:00"). Parsed with
// `new Date(str)`, a floating string yields the same wall-clock components in any
// viewer's zone, so all downstream code (day/month keys, midnight splitting,
// hour-of-day, calendar layout) becomes viewer-independent and physically
// accurate without changing how it reads the dates.

const _tzFormatterCache = {};

function tzFormatter(timeZone) {
    if (!(timeZone in _tzFormatterCache)) {
        try {
            _tzFormatterCache[timeZone] = new Intl.DateTimeFormat("en-US", {
                timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            });
        } catch (error) {
            _tzFormatterCache[timeZone] = null; // unknown zone → fall back to local
        }
    }
    return _tzFormatterCache[timeZone];
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function floatingISOFromParts(p) {
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

function floatingISOFromDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

// Re-project an absolute ISO instant into `timeZone`, returning the floating
// wall-clock string and that zone's UTC offset (minutes) at that instant.
function localize(isoString, timeZone) {
    const instant = new Date(isoString);
    const formatter = timeZone ? tzFormatter(timeZone) : null;
    if (!formatter) {
        return { floating: floatingISOFromDate(instant), offsetMinutes: -instant.getTimezoneOffset() };
    }
    const parts = {};
    for (const part of formatter.formatToParts(instant)) {
        if (part.type !== "literal") parts[part.type] = part.value;
    }
    const hour = parts.hour === "24" ? 0 : Number(parts.hour); // some engines emit "24" for midnight
    const p = { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour, minute: Number(parts.minute), second: Number(parts.second) };
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return { floating: floatingISOFromParts(p), offsetMinutes: Math.round((asUTC - instant.getTime()) / 60000) };
}

function extractDataFromEvent(event, colors, homeTimeZone) {
    const getColor = (colorId) => {
        return colorId ? colors[colorId] || colors.default : colors.default;
    };
    const startTimeZone = event.start.timeZone || null;
    const endTimeZone = event.end.timeZone || null;
    const start = localize(event.start.dateTime, startTimeZone);
    const end = localize(event.end.dateTime, endTimeZone);
    const homeOffset = homeTimeZone ? localize(event.start.dateTime, homeTimeZone).offsetMinutes : start.offsetMinutes;

    return {
        summary: event.summary || "?",
        color: getColor(event.colorId),
        timeZone: startTimeZone,
        offsetMinutes: start.offsetMinutes,
        offsetFromHome: start.offsetMinutes - homeOffset,
        isAway: !!(homeTimeZone && startTimeZone && startTimeZone !== homeTimeZone),
        start: { dateTime: start.floating, timeZone: startTimeZone },
        end: { dateTime: end.floating, timeZone: endTimeZone }
    };
}

function processEvent(event, colors, homeTimeZone) {
    const base = extractDataFromEvent(event, colors, homeTimeZone);
    const start = new Date(base.start.dateTime);
    const end = new Date(base.end.dateTime);
    const timeZone = base.timeZone;

    if (start.toDateString() === end.toDateString()) {
        return [base];
    }

    const splitEvents = [];

    // First part – not a continuation.
    const firstDayEnd = new Date(start);
    firstDayEnd.setDate(firstDayEnd.getDate() + 1);
    firstDayEnd.setHours(0, 0, 0, 0);
    splitEvents.push({
        ...base,
        end: {
            dateTime: floatingISOFromDate(firstDayEnd),
            timeZone
        },
        trueEnd: {
            dateTime: base.end.dateTime,
            timeZone
        },
        continuation: false
    });

    let currentDayStart = new Date(firstDayEnd);
    while (currentDayStart < end) {
        const currentDayEnd = new Date(currentDayStart);
        currentDayEnd.setDate(currentDayEnd.getDate() + 1);
        currentDayEnd.setHours(0, 0, 0, 0);

        splitEvents.push({
            ...base,
            start: {
                dateTime: floatingISOFromDate(currentDayStart),
                timeZone
            },
            trueStart: {
                dateTime: base.start.dateTime,
                timeZone
            },
            end: {
                dateTime: floatingISOFromDate(currentDayEnd < end ? currentDayEnd : end),
                timeZone
            },
            trueEnd: {
                dateTime: base.end.dateTime,
                timeZone
            },
            continuation: true
        });

        currentDayStart = new Date(currentDayEnd);
    }

    return splitEvents;
}

// The zone the user is in most of the time. Everything else is treated as
// "away", which is what the calendar highlights and the insights lab exposes.
function resolveHomeTimeZone(rawEvents) {
    const counts = {};
    rawEvents.forEach((event) => {
        const zone = event.start && event.start.timeZone;
        if (zone) counts[zone] = (counts[zone] || 0) + 1;
    });
    const zones = Object.keys(counts);
    if (!zones.length) return null;
    return zones.sort((a, b) => counts[b] - counts[a])[0];
}

// Turn the raw Google Calendar events into the structures the app consumes.
function buildCalendarData(rawEvents, colors) {
    const homeTimeZone = resolveHomeTimeZone(rawEvents);
    const processedEvents = rawEvents.flatMap((event) => processEvent(event, colors, homeTimeZone));

    const eventsByMonth = {};
    const eventsByDay = {};
    const words = {};

    processedEvents.forEach((event) => {
        const d = new Date(event.start.dateTime);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        if (!eventsByMonth[monthKey]) {
            eventsByMonth[monthKey] = { nonContinuation: 0, hasDay20: false };
        }
        if (!event.continuation) {
            eventsByMonth[monthKey].nonContinuation++;
        }
        if (d.getDate() === 20) {
            // I always update the database entries in the first 1-6 days of the next month, so the
            // hasDay20 variable is a not very elegant but pragmatic way of ensuring full months only
            //
            // NOTE: Every day is logged, at the very least with "?", so having no events on the 20th
            // in a complete month is impossible
            eventsByMonth[monthKey].hasDay20 = true;
        }

        if (!eventsByDay[dayKey]) eventsByDay[dayKey] = [];
        eventsByDay[dayKey].push(event);

        event.summary.split("+").forEach((word) => {
            word = word.trim();
            if (!words[word]) words[word] = [];
            // Store format compatible with main thread's expected structure: [summary, title_element_placeholder, color]
            words[word].push([event.summary, null, event.color]);
        });
    });

    // Filter events that are only continuations in a month
    const finalEvents = processedEvents.filter((event) => {
        const d = new Date(event.start.dateTime);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (event.continuation && eventsByMonth[key].nonContinuation === 0) {
            return false;
        }
        return true;
    });

    const invalidMonthKeys = Object.keys(eventsByMonth).filter((key) => !eventsByMonth[key].hasDay20);

    return {
        events: finalEvents,
        eventsByDay,
        words,
        invalidMonthKeys,
        homeTimeZone
    };
}

// The 20th of the previous calendar month. Data is refreshed monthly (entries
// for a month land in the first few days of the next), so the presence of the
// previous month's 20th is a reliable "is my cached copy still current?" probe.
function previousMonthProbeDate(now = new Date()) {
    return new Date(now.getFullYear(), now.getMonth() - 1, 20);
}

function rawEventsCoverDate(rawEvents, date) {
    const target = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return rawEvents.some((event) => {
        const value = event.start && (event.start.dateTime || event.start.date);
        if (!value) return false;
        const start = new Date(value);
        const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
        return key === target;
    });
}

async function fetchAndDecodeCalendar(url, cacheMode) {
    const response = await fetch(url, cacheMode ? { cache: cacheMode } : undefined);
    if (!response.ok) throw new Error("Network response error");

    const compressedText = await response.text();
    const decompressedResponse = LZString.decompressFromBase64(compressedText);
    return JSON.parse(decompressedResponse);
}

// Fetch + decompress the calendar payload. Shared by the worker and the
// main-thread fallback so the transport logic lives in one place.
//
// First read honours the browser/CDN cache. If that copy already covers the 20th
// of the previous month it is considered current and reused; otherwise the monthly
// update may have happened since it was cached, so we refetch bypassing cache.
async function fetchCalendarData(url) {
    const cached = await fetchAndDecodeCalendar(url, "default");
    if (rawEventsCoverDate(cached, previousMonthProbeDate())) return cached;

    const bustUrl = url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
    return fetchAndDecodeCalendar(bustUrl, "reload");
}
