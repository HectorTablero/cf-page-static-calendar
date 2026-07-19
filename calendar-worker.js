importScripts("https://cdnjs.cloudflare.com/ajax/libs/lz-string/1.4.4/lz-string.min.js", "calendar-processor.js");

self.onmessage = async function (e) {
    const { url, colors } = e.data;

    try {
        const rawEvents = await fetchCalendarData(url);
        const data = buildCalendarData(rawEvents, colors);
        self.postMessage({ success: true, ...data });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
