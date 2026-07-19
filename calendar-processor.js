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

function extractDataFromEvent(event, colors) {
    const getColor = (colorId) => {
        return colorId ? colors[colorId] || colors.default : colors.default;
    };
    return {
        summary: event.summary || "?",
        color: getColor(event.colorId),
        start: event.start,
        end: event.end
    };
}

function processEvent(event, colors) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    if (start.toDateString() === end.toDateString()) {
        return [extractDataFromEvent(event, colors)];
    }

    const splitEvents = [];

    // First part – not a continuation.
    const firstDayEnd = new Date(start);
    firstDayEnd.setDate(firstDayEnd.getDate() + 1);
    firstDayEnd.setHours(0, 0, 0, 0);
    splitEvents.push({
        ...extractDataFromEvent(event, colors),
        end: {
            dateTime: firstDayEnd.toISOString(),
            timeZone: event.start.timeZone
        },
        trueEnd: {
            dateTime: end.toISOString(),
            timeZone: event.end.timeZone
        },
        continuation: false
    });

    let currentDayStart = new Date(firstDayEnd);
    while (currentDayStart < end) {
        const currentDayEnd = new Date(currentDayStart);
        currentDayEnd.setDate(currentDayEnd.getDate() + 1);
        currentDayEnd.setHours(0, 0, 0, 0);

        splitEvents.push({
            ...extractDataFromEvent(event, colors),
            start: {
                dateTime: currentDayStart.toISOString(),
                timeZone: event.start.timeZone
            },
            trueStart: {
                dateTime: start.toISOString(),
                timeZone: event.start.timeZone
            },
            end: {
                dateTime: (currentDayEnd < end ? currentDayEnd : end).toISOString(),
                timeZone: event.end.timeZone
            },
            trueEnd: {
                dateTime: end.toISOString(),
                timeZone: event.end.timeZone
            },
            continuation: true
        });

        currentDayStart = new Date(currentDayEnd);
    }

    return splitEvents;
}

// Turn the raw Google Calendar events into the structures the app consumes.
function buildCalendarData(rawEvents, colors) {
    const processedEvents = rawEvents.flatMap((event) => processEvent(event, colors));

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
        invalidMonthKeys
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
