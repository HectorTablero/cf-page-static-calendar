/* global importScripts, LZString */

importScripts("https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js");

const colors = {
    1: "#b0c4de",
    2: "#aee4c4",
    3: "#d0b1da",
    4: "#f7c2a4",
    5: "#f9dd9b",
    6: "#000",
    7: "#000",
    8: "#b0b0b0",
    9: "#98a8cf",
    10: "#9fbeaa",
    11: "#e5a4a5",
    default: "#e0e0e0"
};

function getColor(colorId) {
    return colorId ? colors[colorId] || colors.default : colors.default;
}

function extractDataFromEvent(event) {
    return {
        summary: event.summary || "?",
        color: getColor(event.colorId),
        start: event.start,
        end: event.end
    };
}

function processEvent(event) {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    if (start.toDateString() === end.toDateString()) {
        return [extractDataFromEvent(event)];
    }

    const splitEvents = [];

    const firstDayEnd = new Date(start);
    firstDayEnd.setDate(firstDayEnd.getDate() + 1);
    firstDayEnd.setHours(0, 0, 0, 0);
    splitEvents.push({
        ...extractDataFromEvent(event),
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
            ...extractDataFromEvent(event),
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

async function loadCalendarEvents(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Network response error");
    }

    const decompressedResponse = LZString.decompressFromBase64(await response.text());
    if (!decompressedResponse) {
        throw new Error("Unable to decompress calendar payload");
    }

    const parsedEvents = JSON.parse(decompressedResponse).flatMap(processEvent);

    const eventsByMonth = {};
    parsedEvents.forEach((event) => {
        const date = new Date(event.start.dateTime);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        if (!eventsByMonth[key]) {
            eventsByMonth[key] = { nonContinuation: 0 };
        }
        if (!event.continuation) {
            eventsByMonth[key].nonContinuation += 1;
        }
    });

    return parsedEvents.filter((event) => {
        const date = new Date(event.start.dateTime);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        return !(event.continuation && eventsByMonth[key].nonContinuation === 0);
    });
}

self.onmessage = async (message) => {
    try {
        const { url } = message.data || {};
        if (!url) {
            throw new Error("Missing calendar URL");
        }

        const events = await loadCalendarEvents(url);
        self.postMessage({ ok: true, events });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
};
