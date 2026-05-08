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
        
        let events = JSON.parse(decompressedResponse).flatMap(event => processEvent(event, colors));

        // Initial filtering (existing logic)
        const eventsByMonth = {};
        events.forEach((event) => {
            const d = new Date(event.start.dateTime);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (!eventsByMonth[key]) {
                eventsByMonth[key] = { nonContinuation: 0, hasDay25: false };
            }
            if (!event.continuation) {
                eventsByMonth[key].nonContinuation++;
            }
            if (d.getDate() === 25) {
                eventsByMonth[key].hasDay25 = true;
            }
        });

        events = events.filter((event) => {
            const d = new Date(event.start.dateTime);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (event.continuation && eventsByMonth[key].nonContinuation === 0) {
                return false;
            }
            return true;
        });

        // Identify months without any events on day 25
        const invalidMonthKeys = Object.keys(eventsByMonth).filter(key => !eventsByMonth[key].hasDay25);

        self.postMessage({ success: true, events, invalidMonthKeys });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
