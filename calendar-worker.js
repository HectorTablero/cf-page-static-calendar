importScripts("https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js");

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

self.onmessage = async function (e) {
    const { url, colors } = e.data;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("Network response error");

        const compressedText = await response.text();
        const decompressedResponse = LZString.decompressFromBase64(compressedText);

        const rawEvents = JSON.parse(decompressedResponse);
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

        self.postMessage({
            success: true,
            events: finalEvents,
            eventsByDay,
            words,
            invalidMonthKeys
        });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
